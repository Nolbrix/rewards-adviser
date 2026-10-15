"""Narrow Windows adapter for the delivered Bing phone reader.

No Windows DLL is loaded until a real WindowDriver is constructed. The injected
API boundary supports deterministic tests without inspecting or touching a UI.
Only a visible, unobscured phone window owned by PhoneExperienceHost.exe or
YourPhoneAppProxy.exe in Microsoft's installed YourPhone package may be captured
or receive navigation input. Images remain in
memory; no clipboard, window text extraction, logging, or screenshot files.
"""
from dataclasses import dataclass
import math
import re
import secrets
import sys
import threading
import time


class NativeError(RuntimeError):
    """A bounded, safe status code; never embeds native/window error text."""
    def __init__(self, code):
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class WindowInfo:
    hwnd: int
    title: str
    pid: int
    exe: str
    bounds: tuple


@dataclass
class Lease:
    window: WindowInfo
    previous_foreground: int
    started_ms: int
    last_input: int
    input_sequence: int = 0
    active: bool = True
    external_activity: bool = False
    cancelled: bool = False


class _InputTracker:
    """A monotonic external-event counter, independent of input timestamps."""
    def __init__(self, tag):
        self.tag = tag
        self.sequence = 0
        self.expected = 0

    def arm(self, expected):
        if self.sequence != expected:
            raise NativeError('input-interrupted')
        self.expected = expected

    def observe(self, injected, tag, release=False):
        if injected and tag == self.tag:
            # An external event may arrive after the last caller-side guard.
            # Suppress that stale injected action in the hook itself; releases
            # must still pass so a partially delivered drag cannot hold a key.
            return release or self.sequence == self.expected
        self.sequence += 1
        return True


def _phone_exe(path):
    if not isinstance(path, str):
        return False
    if path.startswith('\\\\?\\'):
        path = path[4:]
    path = path.replace('/', '\\')
    if '..' in path.split('\\'):
        return False
    return bool(re.fullmatch(r'[a-z]:\\Program Files\\WindowsApps\\Microsoft\.YourPhone_[0-9]+(?:\.[0-9]+){1,3}_(?:x64|x86|arm64|neutral)_[a-z0-9.-]*_8wekyb3d8bbwe\\(?:PhoneExperienceHost|YourPhoneAppProxy)\.exe', path, re.IGNORECASE))


def _valid_bounds(bounds):
    return (isinstance(bounds, (tuple, list)) and len(bounds) == 4
            and all(type(v) is int and -100000 <= v <= 100000 for v in bounds)
            and 0 < bounds[2] - bounds[0] <= 8192
            and 0 < bounds[3] - bounds[1] <= 8192
            and (bounds[2]-bounds[0]) * (bounds[3]-bounds[1]) <= 24000000)


class WindowDriver:
    KEYS = frozenset(('ESC', 'BACK', 'PAGEDOWN'))

    def __init__(self, api=None, lease_timeout_ms=90000):
        if type(lease_timeout_ms) is not int or not 1000 <= lease_timeout_ms <= 300000:
            raise NativeError('invalid-timeout')
        self._api = api if api is not None else _WindowsAPI()
        self._timeout = lease_timeout_ms
        self._lease = None
        self._mouse_down = False
        self._key_down = None

    def _metadata(self, hwnd):
        try:
            row = self._api.inspect(hwnd)
        except Exception:
            raise NativeError('target-unavailable') from None
        if not row:
            raise NativeError('target-unavailable')
        if (not row.get('visible') or row.get('minimized') or not _phone_exe(row.get('exe'))
                or not _valid_bounds(row.get('bounds')) or type(row.get('pid')) is not int or row['pid'] <= 0):
            raise NativeError('target-invalid')
        return WindowInfo(int(row['hwnd']), row['title'], row['pid'], row['exe'], tuple(row['bounds']))

    def find(self, title):
        if not isinstance(title, str) or not title or len(title) > 256 or '\x00' in title:
            raise NativeError('target-invalid')
        matches = []
        invalid = False
        try:
            handles = self._api.enum_windows()
            for hwnd in handles:
                row = self._api.inspect(hwnd)
                if not row or row.get('title') != title:
                    continue
                try:
                    matches.append(self._metadata(hwnd))
                except NativeError:
                    invalid = True
        except Exception:
            raise NativeError('target-unavailable') from None
        if len(matches) > 1:
            raise NativeError('target-ambiguous')
        if not matches:
            raise NativeError('target-invalid' if invalid else 'target-unavailable')
        return matches[0]

    def begin(self, window, idle_ms=15000):
        if self._lease is not None and self._lease.active:
            raise NativeError('lease-busy')
        if type(idle_ms) is not int or not 15000 <= idle_ms <= 3600000:
            raise NativeError('invalid-idle')
        if not isinstance(window, WindowInfo):
            raise NativeError('target-invalid')
        lease = None
        watching = False
        try:
            input_sequence = self._api.start_input_watch()
            watching = True
            if not self._api.desktop_unlocked():
                raise NativeError('desktop-locked')
            now = self._api.now()
            last_input = self._api.last_input()
            age = ((now & 0xffffffff) - last_input) & 0xffffffff
            if age < idle_ms or age > 0x7fffffff:
                raise NativeError('desktop-busy')
            if self._metadata(window.hwnd) != window:
                raise NativeError('target-changed')
            previous = self._api.foreground()
            if not self._api.set_foreground(window.hwnd):
                raise NativeError('target-not-foreground')
            lease = Lease(window, previous, now, last_input, input_sequence)
            self._lease = lease
            self._guard(lease)
            return lease
        except NativeError:
            if lease is not None:
                self.finish(lease)
            elif watching:
                self._api.stop_input_watch()
            raise
        except Exception:
            if lease is not None:
                self.finish(lease)
            elif watching:
                self._api.stop_input_watch()
            raise NativeError('target-unavailable') from None

    def _guard(self, lease):
        if lease is not self._lease or not lease.active or lease.cancelled:
            raise NativeError('lease-invalid')
        try:
            if self._api.input_sequence() != lease.input_sequence or self._api.last_input() != lease.last_input:
                lease.external_activity = True
                raise NativeError('input-interrupted')
            if not self._api.desktop_unlocked():
                raise NativeError('desktop-locked')
            if self._api.now() - lease.started_ms > self._timeout:
                raise NativeError('lease-expired')
            if self._metadata(lease.window.hwnd) != lease.window:
                raise NativeError('target-changed')
            if self._api.foreground() != lease.window.hwnd:
                raise NativeError('target-not-foreground')
            if not self._api.uncovered(lease.window.hwnd, lease.window.bounds):
                raise NativeError('target-covered')
        except NativeError:
            lease.cancelled = True
            raise
        except Exception:
            lease.cancelled = True
            raise NativeError('target-unavailable') from None

    def capture(self, lease):
        self._guard(lease)
        try:
            image = self._api.capture(lease.window.bounds)
            w, h = lease.window.bounds[2] - lease.window.bounds[0], lease.window.bounds[3] - lease.window.bounds[1]
            if not isinstance(image, dict) or image.get('width') != w or image.get('height') != h or not isinstance(image.get('bgra'), bytes) or len(image['bgra']) != w*h*4:
                raise NativeError('capture-failed')
        except Exception:
            lease.cancelled = True
            raise NativeError('capture-failed') from None
        self._guard(lease)  # Discard a frame if focus/input changed during capture.
        return image

    def _point(self, lease, x, y):
        if (type(x) is not int or type(y) is not int or x < 0 or y < 0
                or x >= lease.window.bounds[2]-lease.window.bounds[0]
                or y >= lease.window.bounds[3]-lease.window.bounds[1]):
            raise NativeError('invalid-coordinate')
        return x+lease.window.bounds[0], y+lease.window.bounds[1]

    def _send(self, lease, events):
        self._guard(lease)
        try:
            expected = self._api.send_input(events, expected_sequence=lease.input_sequence)
            actual = self._api.settle_input(expected, lease.last_input)
            if self._api.input_sequence() != lease.input_sequence:
                raise NativeError('input-interrupted')
        except NativeError as error:
            lease.cancelled = True
            if error.code == 'input-interrupted':
                lease.external_activity = True
                raise
            raise NativeError('input-failed') from None
        except Exception:
            lease.cancelled = True
            raise NativeError('input-failed') from None
        if actual != expected:
            lease.cancelled = True
            lease.external_activity = True
            raise NativeError('input-interrupted')
        lease.last_input = actual
        self._guard(lease)

    def _release(self):
        if self._mouse_down:
            self._mouse_down = False
            try:
                self._api.send_input([('left_up',)])
            except Exception:
                pass

    def _release_key(self):
        if self._key_down is not None:
            key, self._key_down = self._key_down, None
            try:
                self._api.send_input([('key_up', key)])
            except Exception:
                pass

    def click(self, lease, x, y):
        self._guard(lease)
        point = self._point(lease, x, y)
        self._mouse_down = True  # Also release safely if SendInput inserts only part.
        try:
            self._send(lease, [('move', *point), ('left_down',), ('left_up',)])
            self._mouse_down = False
        finally:
            self._release()

    def key(self, lease, name):
        self._guard(lease)
        if not isinstance(name, str) or name not in self.KEYS:
            raise NativeError('invalid-key')
        self._key_down = name
        try:
            self._send(lease, [('key_down', name), ('key_up', name)])
            self._key_down = None
        finally:
            self._release_key()

    def scroll(self, lease, x, y, delta=120):
        self._guard(lease)
        point=self._point(lease,x,y)
        if type(delta) is not int or delta==0 or abs(delta)>1200 or delta%120:
            raise NativeError('invalid-scroll')
        self._send(lease,[('move',*point),('wheel',delta)])

    def drag(self, lease, x1, y1, x2, y2):
        self._guard(lease)
        start, end = self._point(lease,x1,y1), self._point(lease,x2,y2)
        self._mouse_down = True
        try:
            self._send(lease, [('move',*start),('left_down',)])
            steps = max(4, min(20, int(math.hypot(end[0]-start[0],end[1]-start[1])/30)))
            for i in range(1,steps+1):
                point = (round(start[0]+(end[0]-start[0])*i/steps),round(start[1]+(end[1]-start[1])*i/steps))
                self._send(lease,[('move',*point)])
                time.sleep(0.012)
            self._send(lease,[('left_up',)])
            self._mouse_down=False
        finally:
            self._release()

    def finish(self, lease):
        if lease is not self._lease or not lease.active:
            return
        self._release()
        self._release_key()
        try:
            if self._api.input_sequence() != lease.input_sequence or self._api.last_input() != lease.last_input:
                lease.external_activity=True
            if (not lease.external_activity and self._api.desktop_unlocked()
                    and self._api.foreground()==lease.window.hwnd
                    and lease.previous_foreground and lease.previous_foreground!=lease.window.hwnd
                    and self._api.is_window(lease.previous_foreground)):
                self._api.set_foreground(lease.previous_foreground)
        except Exception:
            pass
        finally:
            lease.active=False
            self._lease=None
            self._api.stop_input_watch()


class _WindowsAPI:
    """Private ctypes boundary. It has no user-supplied executable or input text."""
    def __init__(self):
        if sys.platform != 'win32':
            raise NativeError('platform-unavailable')
        import ctypes as c
        from ctypes import wintypes as w
        self.c, self.w = c, w
        self.u=c.WinDLL('user32',use_last_error=True)
        self.k=c.WinDLL('kernel32',use_last_error=True)
        self.g=c.WinDLL('gdi32',use_last_error=True)
        self.d=c.WinDLL('dwmapi',use_last_error=True)
        self.ULONG_PTR=c.c_size_t
        class POINT(c.Structure): _fields_=[('x',w.LONG),('y',w.LONG)]
        class RECT(c.Structure): _fields_=[('left',w.LONG),('top',w.LONG),('right',w.LONG),('bottom',w.LONG)]
        class LASTINPUTINFO(c.Structure): _fields_=[('cbSize',w.UINT),('dwTime',w.DWORD)]
        class MOUSEINPUT(c.Structure): _fields_=[('dx',w.LONG),('dy',w.LONG),('mouseData',w.DWORD),('dwFlags',w.DWORD),('time',w.DWORD),('dwExtraInfo',c.c_size_t)]
        class KEYBDINPUT(c.Structure): _fields_=[('wVk',w.WORD),('wScan',w.WORD),('dwFlags',w.DWORD),('time',w.DWORD),('dwExtraInfo',c.c_size_t)]
        class HARDWAREINPUT(c.Structure): _fields_=[('uMsg',w.DWORD),('wParamL',w.WORD),('wParamH',w.WORD)]
        class INPUTUNION(c.Union): _fields_=[('mi',MOUSEINPUT),('ki',KEYBDINPUT),('hi',HARDWAREINPUT)]
        class INPUT(c.Structure): _anonymous_=('data',); _fields_=[('type',w.DWORD),('data',INPUTUNION)]
        class BITMAPINFOHEADER(c.Structure): _fields_=[('biSize',w.DWORD),('biWidth',w.LONG),('biHeight',w.LONG),('biPlanes',w.WORD),('biBitCount',w.WORD),('biCompression',w.DWORD),('biSizeImage',w.DWORD),('biXPelsPerMeter',w.LONG),('biYPelsPerMeter',w.LONG),('biClrUsed',w.DWORD),('biClrImportant',w.DWORD)]
        class RGBQUAD(c.Structure): _fields_=[('rgbBlue',w.BYTE),('rgbGreen',w.BYTE),('rgbRed',w.BYTE),('rgbReserved',w.BYTE)]
        class BITMAPINFO(c.Structure): _fields_=[('bmiHeader',BITMAPINFOHEADER),('bmiColors',RGBQUAD*1)]
        class MOUSEHOOK(c.Structure): _fields_=[('pt',POINT),('mouseData',w.DWORD),('flags',w.DWORD),('time',w.DWORD),('dwExtraInfo',c.c_size_t)]
        class KEYBOARDHOOK(c.Structure): _fields_=[('vkCode',w.DWORD),('scanCode',w.DWORD),('flags',w.DWORD),('time',w.DWORD),('dwExtraInfo',c.c_size_t)]
        self.RECT,self.POINT,self.LASTINPUTINFO,self.INPUT,self.BITMAPINFO=RECT,POINT,LASTINPUTINFO,INPUT,BITMAPINFO
        self.MOUSEHOOK,self.KEYBOARDHOOK=MOUSEHOOK,KEYBOARDHOOK
        self.WNDENUMPROC=c.WINFUNCTYPE(w.BOOL,w.HWND,w.LPARAM)
        self.HOOKPROC=c.WINFUNCTYPE(c.c_ssize_t,c.c_int,w.WPARAM,w.LPARAM)
        def declare(dll,name,result,args):
            fn=getattr(dll,name);fn.restype=result;fn.argtypes=args;return fn
        declare(self.u,'EnumWindows',w.BOOL,[self.WNDENUMPROC,w.LPARAM])
        for name in ('IsWindow','IsWindowVisible','IsIconic','SetForegroundWindow'):
            declare(self.u,name,w.BOOL,[w.HWND])
        declare(self.u,'GetForegroundWindow',w.HWND,[])
        declare(self.u,'GetWindowTextLengthW',c.c_int,[w.HWND])
        declare(self.u,'GetWindowTextW',c.c_int,[w.HWND,w.LPWSTR,c.c_int])
        declare(self.u,'GetWindowThreadProcessId',w.DWORD,[w.HWND,c.POINTER(w.DWORD)])
        declare(self.u,'GetLastInputInfo',w.BOOL,[c.POINTER(LASTINPUTINFO)])
        declare(self.u,'SetWindowsHookExW',w.HANDLE,[c.c_int,self.HOOKPROC,w.HINSTANCE,w.DWORD])
        declare(self.u,'UnhookWindowsHookEx',w.BOOL,[w.HANDLE])
        declare(self.u,'CallNextHookEx',c.c_ssize_t,[w.HANDLE,c.c_int,w.WPARAM,w.LPARAM])
        declare(self.u,'PeekMessageW',w.BOOL,[c.POINTER(w.MSG),w.HWND,w.UINT,w.UINT,w.UINT])
        declare(self.u,'GetMessageW',c.c_int,[c.POINTER(w.MSG),w.HWND,w.UINT,w.UINT])
        declare(self.u,'PostThreadMessageW',w.BOOL,[w.DWORD,w.UINT,w.WPARAM,w.LPARAM])
        declare(self.u,'GetSystemMetrics',c.c_int,[c.c_int])
        declare(self.u,'SendInput',w.UINT,[w.UINT,c.POINTER(INPUT),c.c_int])
        declare(self.u,'GetDC',w.HDC,[w.HWND]); declare(self.u,'ReleaseDC',c.c_int,[w.HWND,w.HDC])
        declare(self.u,'OpenInputDesktop',w.HANDLE,[w.DWORD,w.BOOL,w.DWORD])
        declare(self.u,'CloseDesktop',w.BOOL,[w.HANDLE])
        declare(self.u,'GetUserObjectInformationW',w.BOOL,[w.HANDLE,c.c_int,w.LPVOID,w.DWORD,c.POINTER(w.DWORD)])
        declare(self.k,'OpenProcess',w.HANDLE,[w.DWORD,w.BOOL,w.DWORD])
        declare(self.k,'CloseHandle',w.BOOL,[w.HANDLE])
        declare(self.k,'QueryFullProcessImageNameW',w.BOOL,[w.HANDLE,w.DWORD,w.LPWSTR,c.POINTER(w.DWORD)])
        declare(self.k,'GetTickCount64',c.c_ulonglong,[])
        declare(self.k,'GetCurrentThreadId',w.DWORD,[])
        declare(self.k,'GetModuleHandleW',w.HMODULE,[w.LPCWSTR])
        declare(self.d,'DwmGetWindowAttribute',c.c_long,[w.HWND,w.DWORD,w.LPVOID,w.DWORD])
        declare(self.g,'CreateCompatibleDC',w.HDC,[w.HDC])
        declare(self.g,'CreateCompatibleBitmap',w.HBITMAP,[w.HDC,c.c_int,c.c_int])
        declare(self.g,'SelectObject',w.HGDIOBJ,[w.HDC,w.HGDIOBJ])
        declare(self.g,'DeleteObject',w.BOOL,[w.HGDIOBJ]); declare(self.g,'DeleteDC',w.BOOL,[w.HDC])
        declare(self.g,'BitBlt',w.BOOL,[w.HDC,c.c_int,c.c_int,c.c_int,c.c_int,w.HDC,c.c_int,c.c_int,w.DWORD])
        declare(self.g,'GetDIBits',c.c_int,[w.HDC,w.HBITMAP,w.UINT,w.UINT,w.LPVOID,c.POINTER(BITMAPINFO),w.UINT])
        # Per-thread DPI context keeps frame bounds, capture and input in physical
        # pixels without changing an already initialized application's DPI policy.
        try:
            self.dpi=declare(self.u,'SetThreadDpiAwarenessContext',w.HANDLE,[w.HANDLE])
        except AttributeError:
            self.dpi=None
        self._input_tag=secrets.randbits(c.sizeof(c.c_size_t)*8) or 1
        self._watch=None

    def start_input_watch(self):
        if self._watch is not None:
            raise NativeError('input-watch-unavailable')
        self._watch=_LowLevelInputWatch(self,self._input_tag)
        try:
            self._watch.start()
            return self._watch.sequence()
        except Exception:
            self.stop_input_watch()
            raise NativeError('input-watch-unavailable') from None

    def input_sequence(self):
        if self._watch is None:
            raise NativeError('input-watch-unavailable')
        return self._watch.sequence()

    def stop_input_watch(self):
        if self._watch is not None:
            self._watch.stop()
            if not self._watch.thread.is_alive():
                self._watch=None

    def _enter_dpi(self):
        return self.dpi(self.c.c_void_p(-4)) if self.dpi else None
    def _exit_dpi(self, previous):
        if previous and self.dpi: self.dpi(previous)
    def now(self): return int(self.k.GetTickCount64())
    def last_input(self):
        item=self.LASTINPUTINFO();item.cbSize=self.c.sizeof(item)
        if not self.u.GetLastInputInfo(self.c.byref(item)): raise NativeError('input-unavailable')
        return int(item.dwTime)
    def desktop_unlocked(self):
        desk=self.u.OpenInputDesktop(0,False,1)
        if not desk: return False
        try:
            size=self.w.DWORD();buf=self.c.create_unicode_buffer(256)
            return bool(self.u.GetUserObjectInformationW(desk,2,buf,self.c.sizeof(buf),self.c.byref(size)) and buf.value.casefold()=='default')
        finally: self.u.CloseDesktop(desk)
    def enum_windows(self):
        out=[]
        @self.WNDENUMPROC
        def visit(hwnd,param): out.append(int(hwnd));return True
        if not self.u.EnumWindows(visit,0): raise NativeError('target-unavailable')
        return out
    def _bounds(self,hwnd):
        rect=self.RECT()
        if self.d.DwmGetWindowAttribute(hwnd,9,self.c.byref(rect),self.c.sizeof(rect))!=0: return None
        return (int(rect.left),int(rect.top),int(rect.right),int(rect.bottom))
    def inspect(self,hwnd):
        if not self.u.IsWindow(hwnd): return None
        old=self._enter_dpi()
        try:
            length=self.u.GetWindowTextLengthW(hwnd)
            if length>1024: return None
            text=self.c.create_unicode_buffer(max(2,length+1));self.u.GetWindowTextW(hwnd,text,len(text))
            pid=self.w.DWORD();self.u.GetWindowThreadProcessId(hwnd,self.c.byref(pid))
            proc=self.k.OpenProcess(0x1000,False,pid.value)
            if not proc: return None
            try:
                path=self.c.create_unicode_buffer(32768);size=self.w.DWORD(len(path))
                if not self.k.QueryFullProcessImageNameW(proc,0,path,self.c.byref(size)):return None
                exe=path.value
            finally:self.k.CloseHandle(proc)
            return dict(hwnd=int(hwnd),title=text.value,pid=int(pid.value),exe=exe,bounds=self._bounds(hwnd),visible=bool(self.u.IsWindowVisible(hwnd)),minimized=bool(self.u.IsIconic(hwnd)))
        finally:self._exit_dpi(old)
    def foreground(self):return int(self.u.GetForegroundWindow() or 0)
    def is_window(self,hwnd):return bool(self.u.IsWindow(hwnd))
    def set_foreground(self,hwnd):
        if self.foreground()==hwnd:return True
        if not self.u.SetForegroundWindow(hwnd):return False
        return self.foreground()==hwnd
    def uncovered(self,hwnd,bounds):
        old=self._enter_dpi()
        try:
            left=self.u.GetSystemMetrics(76);top=self.u.GetSystemMetrics(77)
            right=left+self.u.GetSystemMetrics(78);bottom=top+self.u.GetSystemMetrics(79)
            if bounds[0]<left or bounds[1]<top or bounds[2]>right or bounds[3]>bottom:return False
            for other in self.enum_windows():
                if other==hwnd:return True
                if not self.u.IsWindowVisible(other) or self.u.IsIconic(other):continue
                cloaked=self.w.DWORD()
                if self.d.DwmGetWindowAttribute(other,14,self.c.byref(cloaked),self.c.sizeof(cloaked))!=0:return False
                if cloaked.value:continue
                rect=self._bounds(other)
                if not _valid_bounds(rect):return False
                if max(rect[0],bounds[0])<min(rect[2],bounds[2]) and max(rect[1],bounds[1])<min(rect[3],bounds[3]):return False
            return False
        finally:self._exit_dpi(old)
    def capture(self,bounds):
        old=self._enter_dpi();screen=None;memory=None;bitmap=None;previous=None
        try:
            width,height=bounds[2]-bounds[0],bounds[3]-bounds[1]
            screen=self.u.GetDC(None)
            if not screen:raise NativeError('capture-failed')
            memory=self.g.CreateCompatibleDC(screen);bitmap=self.g.CreateCompatibleBitmap(screen,width,height)
            if not memory or not bitmap:raise NativeError('capture-failed')
            previous=self.g.SelectObject(memory,bitmap)
            if not previous or previous==self.c.c_void_p(-1).value:raise NativeError('capture-failed')
            if not self.g.BitBlt(memory,0,0,width,height,screen,bounds[0],bounds[1],0x40CC0020):raise NativeError('capture-failed')
            self.g.SelectObject(memory,previous);previous=None
            info=self.BITMAPINFO();info.bmiHeader.biSize=self.c.sizeof(info.bmiHeader);info.bmiHeader.biWidth=width;info.bmiHeader.biHeight=-height;info.bmiHeader.biPlanes=1;info.bmiHeader.biBitCount=32;info.bmiHeader.biCompression=0
            pixels=(self.c.c_ubyte*(width*height*4))()
            if self.g.GetDIBits(screen,bitmap,0,height,pixels,self.c.byref(info),0)!=height:raise NativeError('capture-failed')
            # BI_RGB alpha is undefined; normalize it for the vision interface.
            pixels=bytearray(pixels);pixels[3::4]=b'\xff'*(width*height)
            return dict(width=width,height=height,bgra=bytes(pixels))
        finally:
            if previous and memory:self.g.SelectObject(memory,previous)
            if bitmap:self.g.DeleteObject(bitmap)
            if memory:self.g.DeleteDC(memory)
            if screen:self.u.ReleaseDC(None,screen)
            self._exit_dpi(old)
    def send_input(self,events,expected_sequence=None):
        if expected_sequence is not None:
            if self._watch is None:
                raise NativeError('input-watch-unavailable')
            self._watch.sequence()
            self._watch.tracker.arm(expected_sequence)
        elif not all(event[0] in ('left_up','key_up') for event in events):
            raise NativeError('input-failed')
        old=self._enter_dpi()
        try:
            timestamp=self.now()&0xffffffff
            values=(self.INPUT*len(events))()
            left=self.u.GetSystemMetrics(76);top=self.u.GetSystemMetrics(77);width=self.u.GetSystemMetrics(78);height=self.u.GetSystemMetrics(79)
            if width<=1 or height<=1:raise NativeError('input-failed')
            for item,event in zip(values,events):
                name=event[0]
                if name=='move':
                    item.type=0;item.mi.dx=round((event[1]-left)*65535/(width-1));item.mi.dy=round((event[2]-top)*65535/(height-1));item.mi.dwFlags=0x0001|0x8000|0x4000;item.mi.time=timestamp;item.mi.dwExtraInfo=self._input_tag
                elif name in ('left_down','left_up'):
                    item.type=0;item.mi.dwFlags=2 if name=='left_down' else 4;item.mi.time=timestamp;item.mi.dwExtraInfo=self._input_tag
                elif name=='wheel':
                    item.type=0;item.mi.mouseData=event[1]&0xffffffff;item.mi.dwFlags=0x0800;item.mi.time=timestamp;item.mi.dwExtraInfo=self._input_tag
                elif name in ('key_down','key_up'):
                    item.type=1;item.ki.wVk={'ESC':27,'BACK':8,'PAGEDOWN':34}[event[1]];item.ki.dwFlags=2 if name=='key_up' else 0;item.ki.time=timestamp;item.ki.dwExtraInfo=self._input_tag
                else:raise NativeError('input-failed')
            if self.u.SendInput(len(values),values,self.c.sizeof(self.INPUT))!=len(values):raise NativeError('input-failed')
            return timestamp
        finally:self._exit_dpi(old)
    def settle_input(self,expected,baseline):
        for _ in range(12):
            actual=self.last_input()
            if actual==expected:return actual
            if actual!=baseline:return actual
            time.sleep(0.01)
        return self.last_input()


class _LowLevelInputWatch:
    """Lease-scoped hooks. Observe event metadata only; never retain key values."""
    def __init__(self,api,tag):
        self.api=api
        self.tracker=_InputTracker(tag)
        self.thread=threading.Thread(target=self._run,name='RewardsPhoneInputWatch',daemon=True)
        self.ready=threading.Event()
        self.stopping=threading.Event()
        self.running=False
        self.failed=False
        self.thread_id=0
        self.callbacks=[]

    def start(self):
        self.thread.start()
        if not self.ready.wait(2) or self.failed or not self.running:
            self.stop()
            raise NativeError('input-watch-unavailable')

    def sequence(self):
        if not self.running or self.failed or self.stopping.is_set() or not self.thread.is_alive():
            raise NativeError('input-watch-unavailable')
        return self.tracker.sequence

    def stop(self):
        self.stopping.set()
        if self.thread_id and self.thread.is_alive():
            self.api.u.PostThreadMessageW(self.thread_id,0x0012,0,0)
        if self.thread.ident is not None and self.thread is not threading.current_thread():
            self.thread.join(2)
        if self.thread.is_alive():
            self.failed=True

    def _callback(self,keyboard,code,message,pointer):
        api=self.api
        try:
            if code>=0:
                item=api.c.cast(pointer,api.c.POINTER(api.KEYBOARDHOOK if keyboard else api.MOUSEHOOK)).contents
                injected=bool(item.flags & (0x10 if keyboard else 0x01))
                release=message in ((0x0101,0x0105) if keyboard else (0x0202,0x0205,0x0208,0x020c))
                own=injected and item.dwExtraInfo==self.tracker.tag
                if own and self.failed and not release:
                    return 1
                if not self.tracker.observe(injected,int(item.dwExtraInfo),release):
                    return 1
        except Exception:
            self.failed=True
        return api.u.CallNextHookEx(None,code,message,pointer)

    def _run(self):
        api=self.api
        hooks=[]
        try:
            self.thread_id=int(api.k.GetCurrentThreadId())
            message=api.w.MSG()
            api.u.PeekMessageW(api.c.byref(message),None,0,0,0) # Create the thread's queue.
            module=api.k.GetModuleHandleW(None)
            self.callbacks=[api.HOOKPROC(lambda code,msg,ptr:self._callback(False,code,msg,ptr)),
                            api.HOOKPROC(lambda code,msg,ptr:self._callback(True,code,msg,ptr))]
            for kind,callback in zip((14,13),self.callbacks):
                handle=api.u.SetWindowsHookExW(kind,callback,module,0)
                if not handle:
                    raise NativeError('input-watch-unavailable')
                hooks.append(handle)
            self.running=True
            self.ready.set()
            while not self.stopping.is_set():
                result=api.u.GetMessageW(api.c.byref(message),None,0,0)
                if result==0:
                    break
                if result<0:
                    raise NativeError('input-watch-unavailable')
        except Exception:
            self.failed=True
        finally:
            self.running=False
            for handle in reversed(hooks):
                api.u.UnhookWindowsHookEx(handle)
            self.ready.set()
