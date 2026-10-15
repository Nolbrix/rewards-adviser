import importlib.util
from pathlib import Path
import sys
import unittest

spec = importlib.util.spec_from_file_location('phone_native', Path(__file__).parents[1] / 'companion/phone_native.py')
native = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = native
try:
    spec.loader.exec_module(native)
except FileNotFoundError:
    native = None

EXE = r'C:\Program Files\WindowsApps\Microsoft.YourPhone_1.0_x64__8wekyb3d8bbwe\PhoneExperienceHost.exe'

class FakeAPI:
    def __init__(self):
        self.now_ms=50000; self.input_at=1000; self.locked=False; self.focus=99
        self.windows={10:dict(hwnd=10,title='Galaxy A35',pid=123,exe=EXE,bounds=(100,100,500,900),visible=True,minimized=False)}
        self.covered=False; self.pointer=(0,0); self.pressed=False; self.key_pressed=False; self.moves=[]
        self.after_send=None; self.fail_capture=False; self.fail_send=False
        self.external_sequence=0; self.watching=False; self.before_send=None; self.watch_fails=False; self.wheels=[]
    def now(self): return self.now_ms
    def last_input(self): return self.input_at
    def desktop_unlocked(self): return not self.locked
    def enum_windows(self): return list(self.windows)
    def inspect(self, hwnd): return dict(self.windows[hwnd]) if hwnd in self.windows else None
    def foreground(self): return self.focus
    def set_foreground(self, hwnd): self.focus=hwnd; return True
    def start_input_watch(self):
        if self.watch_fails: raise native.NativeError('input-watch-unavailable')
        self.watching=True
        return self.external_sequence
    def input_sequence(self):
        if not self.watching: raise native.NativeError('input-watch-unavailable')
        return self.external_sequence
    def stop_input_watch(self): self.watching=False
    def is_window(self, hwnd): return hwnd in self.windows or hwnd==99
    def uncovered(self, hwnd, bounds): return not self.covered
    def capture(self, bounds):
        if self.fail_capture: raise RuntimeError('private details')
        w,h=bounds[2]-bounds[0],bounds[3]-bounds[1]
        return dict(width=w,height=h,bgra=bytes((1,2,3,255))*w*h)
    def send_input(self, events, expected_sequence=None):
        if self.before_send: self.before_send(self, events)
        if expected_sequence is not None and expected_sequence != self.external_sequence:
            raise native.NativeError('input-interrupted')
        self.now_ms+=1; self.input_at=self.now_ms & 0xffffffff
        expected=self.input_at
        applied=events[:(1 if events[0][0].startswith('key_') else 2)] if self.fail_send else events
        for e in applied:
            if e[0]=='move': self.pointer=(e[1],e[2]); self.moves.append(self.pointer)
            if e[0]=='left_down': self.pressed=True
            if e[0]=='left_up': self.pressed=False
            if e[0]=='key_down': self.key_pressed=True
            if e[0]=='key_up': self.key_pressed=False
            if e[0]=='wheel': self.wheels.append(e[1])
        if self.after_send: self.after_send(self, events)
        if self.fail_send:
            self.fail_send=False
            raise RuntimeError('input private details')
        return expected
    def settle_input(self, expected, baseline): return self.last_input()

class NativeTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(native, 'Phone adapter not implemented')
        self.api=FakeAPI(); self.driver=native.WindowDriver(api=self.api)
    def begin(self): return self.driver.begin(self.driver.find('Galaxy A35'))
    def fails(self, code, fn, *args):
        with self.assertRaises(native.NativeError) as got: fn(*args)
        self.assertEqual(got.exception.code, code)
        self.assertEqual(str(got.exception), code)
    def test_exact_phone_target_only_and_ambiguity(self):
        self.assertEqual(self.driver.find('Galaxy A35').pid,123)
        self.fails('target-unavailable',self.driver.find,'Galaxy')
        self.api.windows[11]=dict(self.api.windows[10],hwnd=11)
        self.fails('target-ambiguous',self.driver.find,'Galaxy A35')
    def test_impostor_process_and_hidden_minimized_are_rejected(self):
        for change in [dict(exe=r'C:\Temp\PhoneExperienceHost.exe'),dict(exe=EXE.replace('Microsoft.YourPhone_','OtherApp_')),dict(exe=EXE.replace('8wekyb3d8bbwe','notmicrosoft')),dict(visible=False),dict(minimized=True)]:
            self.api.windows[10].update(change)
            self.fails('target-invalid',self.driver.find,'Galaxy A35')
            self.api=FakeAPI(); self.driver=native.WindowDriver(api=self.api)
    def test_official_phone_proxy_is_accepted_but_impostor_proxy_is_rejected(self):
        proxy=EXE.replace('PhoneExperienceHost.exe','YourPhoneAppProxy.exe')
        self.api.windows[10]['exe']=proxy
        window=self.driver.find('Galaxy A35')
        self.assertEqual(window.exe,proxy)
        lease=self.driver.begin(window)
        self.assertEqual(self.driver.capture(lease)['width'],400)
        self.driver.finish(lease)
        for bad in (r'C:\Temp\YourPhoneAppProxy.exe',proxy.replace('8wekyb3d8bbwe','notmicrosoft'),proxy.replace('Microsoft.YourPhone_','OtherApp_'),proxy.replace('YourPhoneAppProxy.exe','YourPhoneAppProxyEvil.exe')):
            self.api.windows[10]['exe']=bad
            self.fails('target-invalid',self.driver.find,'Galaxy A35')
    def test_idle_locked_and_untrusted_window_objects(self):
        w=self.driver.find('Galaxy A35')
        self.api.input_at=49999; self.fails('desktop-busy',self.driver.begin,w)
        self.api.input_at=1000; self.api.locked=True; self.fails('desktop-locked',self.driver.begin,w)
        self.api.locked=False
        bad=native.WindowInfo(10,'Galaxy A35',123,r'C:\evil.exe',(100,100,500,900))
        self.fails('target-changed',self.driver.begin,bad)
    def test_capture_is_memory_only_correct_bounds_and_restores_focus(self):
        lease=self.begin(); self.assertEqual(self.api.focus,10)
        image=self.driver.capture(lease)
        self.assertEqual((image['width'],image['height']),(400,800))
        self.assertEqual(len(image['bgra']),400*800*4)
        self.driver.finish(lease); self.assertEqual(self.api.focus,99)
        self.driver.finish(lease)
    def test_external_input_cancels_without_restoring_focus(self):
        lease=self.begin(); self.api.input_at+=1
        self.fails('input-interrupted',self.driver.capture,lease)
        self.driver.finish(lease); self.assertEqual(self.api.focus,10)
    def test_lock_focus_target_resize_minimize_and_cover_abort(self):
        for code,change in [('desktop-locked',lambda: setattr(self.api,'locked',True)),('target-not-foreground',lambda:setattr(self.api,'focus',99)),('target-changed',lambda:self.api.windows[10].update(bounds=(0,0,400,800))),('target-invalid',lambda:self.api.windows[10].update(minimized=True)),('target-covered',lambda:setattr(self.api,'covered',True))]:
            self.api=FakeAPI(); self.driver=native.WindowDriver(api=self.api); lease=self.begin(); change()
            self.fails(code,self.driver.capture,lease); self.driver.finish(lease)
    def test_coordinate_validation_never_injects_and_keys_are_allowlisted(self):
        lease=self.begin()
        for point in [(-1,0),(400,0),(0,800),(float('nan'),0),(True,0),(1.2,3)]:
            self.fails('invalid-coordinate',self.driver.click,lease,*point)
        self.assertFalse(self.api.moves)
        self.fails('invalid-key',self.driver.key,lease,'WIN')
        self.driver.key(lease,'ESC'); self.driver.key(lease,'PAGEDOWN')
    def test_own_input_is_accepted_but_mid_drag_external_input_aborts_and_releases(self):
        lease=self.begin(); self.driver.click(lease,10,20)
        self.assertEqual(self.api.pointer,(110,120)); self.assertFalse(self.api.pressed)
        self.driver.capture(lease)
        def interrupt(api, events):
            if any(e[0]=='left_down' for e in events): api.input_at+=77
        self.api.after_send=interrupt
        self.fails('input-interrupted',self.driver.drag,lease,20,700,20,100)
        self.assertFalse(self.api.pressed)
        self.assertTrue(lease.external_activity)
    def test_input_failure_releases_mouse_and_exception_has_no_private_details(self):
        lease=self.begin(); self.api.fail_send=True
        self.fails('input-failed',self.driver.click,lease,1,1)
        self.assertFalse(self.api.pressed)
    def test_capture_failure_and_expired_or_foreign_lease_fail_closed(self):
        lease=self.begin(); self.api.fail_capture=True
        self.fails('capture-failed',self.driver.capture,lease)
        self.driver.finish(lease)
        lease=self.begin(); self.api.now_ms+=90001
        self.fails('lease-expired',self.driver.capture,lease)
        self.driver.finish(lease)
        self.fails('lease-invalid',self.driver.capture,lease)
    def test_input_change_during_capture_discards_image(self):
        lease=self.begin(); original=self.api.capture
        def changed(bounds):
            result=original(bounds); self.api.input_at+=5; return result
        self.api.capture=changed
        self.fails('input-interrupted',self.driver.capture,lease)
    def test_failed_begin_releases_lease_and_restores_focus_when_safe(self):
        self.api.covered=True
        self.fails('target-covered',self.begin)
        self.assertEqual(self.api.focus,99)
        self.api.covered=False
        self.driver.finish(self.begin())
    def test_cancelled_lease_cannot_resume_if_focus_or_input_is_restored(self):
        lease=self.begin();self.api.covered=True
        self.fails('target-covered',self.driver.capture,lease)
        self.api.covered=False
        self.fails('lease-invalid',self.driver.capture,lease)
        self.driver.finish(lease)
    def test_key_partial_failure_releases_and_only_bounded_keys_are_accepted(self):
        lease=self.begin();self.api.fail_send=True
        self.fails('input-failed',self.driver.key,lease,'ESC')
        self.assertFalse(self.api.key_pressed)
        self.driver.finish(lease)
        self.api.now_ms+=16000
        lease=self.begin()
        self.fails('invalid-key',self.driver.key,lease,[])
    def test_gdi_capture_always_releases_resources_on_blt_or_dib_failure(self):
        import ctypes as c
        from types import SimpleNamespace
        class Header(c.Structure):
            _fields_=[('biSize',c.c_uint32),('biWidth',c.c_long),('biHeight',c.c_long),('biPlanes',c.c_uint16),('biBitCount',c.c_uint16),('biCompression',c.c_uint32)]
        class Info(c.Structure): _fields_=[('bmiHeader',Header)]
        for fail in ('blt','dib',None):
            trace=[]
            def select(dc,obj): trace.append(('select',obj));return 444
            def dib(dc,bm,first,height,pixels,info,usage):
                if fail=='dib':return 0
                for i in range(len(pixels)):pixels[i]=5
                return height
            api=native._WindowsAPI.__new__(native._WindowsAPI)
            api.c=c;api.BITMAPINFO=Info
            api._enter_dpi=lambda:None;api._exit_dpi=lambda old:trace.append(('dpi',old))
            api.u=SimpleNamespace(GetDC=lambda hwnd:111,ReleaseDC=lambda hwnd,dc:trace.append(('release',dc)))
            api.g=SimpleNamespace(CreateCompatibleDC=lambda dc:222,CreateCompatibleBitmap=lambda dc,w,h:333,SelectObject=select,BitBlt=lambda *args:fail!='blt',GetDIBits=dib,DeleteObject=lambda obj:trace.append(('delete-object',obj)),DeleteDC=lambda dc:trace.append(('delete-dc',dc)))
            if fail:
                with self.assertRaises(native.NativeError):api.capture((0,0,2,2))
            else:
                result=api.capture((0,0,2,2));self.assertEqual(result['bgra'],bytes((5,5,5,255))*4)
            self.assertEqual(trace,[('select',333),('select',444),('delete-object',333),('delete-dc',222),('release',111),('dpi',None)])
    def test_uint32_idle_wrap_is_handled(self):
        self.api.now_ms=2**32+30000; self.api.input_at=2**32-1000
        lease=self.begin(); self.assertEqual(self.driver.capture(lease)['width'],400)
        self.driver.finish(lease)
    def test_external_input_before_own_timestamp_is_not_hidden_by_send_input(self):
        lease=self.begin()
        def interrupted(api, events):
            api.external_sequence+=1
            # The following own input overwrites GetLastInputInfo with its time.
        self.api.before_send=interrupted
        self.fails('input-interrupted',self.driver.click,lease,20,30)
        self.assertFalse(self.api.moves)
        self.assertTrue(lease.external_activity)
        self.driver.finish(lease)
        self.assertFalse(self.api.watching)
    def test_external_sequence_cancels_even_when_last_input_time_matches(self):
        lease=self.begin(); self.api.external_sequence+=1
        self.fails('input-interrupted',self.driver.capture,lease)
        self.driver.finish(lease)
    def test_unavailable_input_watch_cannot_take_foreground(self):
        self.api.watch_fails=True
        self.fails('input-watch-unavailable',self.begin)
        self.assertEqual(self.api.focus,99)
        self.assertFalse(self.api.watching)
    def test_scroll_targets_relative_point_and_validates_wheel_delta(self):
        self.assertTrue(hasattr(self.driver,'scroll'), 'Guarded wheel navigation is not implemented')
        lease=self.begin()
        self.driver.scroll(lease,240,599,delta=-120)
        self.assertEqual(self.api.pointer,(340,699))
        self.assertEqual(self.api.wheels,[-120])
        for delta in (True,0,1,1201,-1320,'120'):
            with self.subTest(delta=delta): self.fails('invalid-scroll',self.driver.scroll,lease,1,1,delta)
        self.assertEqual(self.api.wheels,[-120])
    def test_scroll_aborts_on_external_event_before_own_input(self):
        self.assertTrue(hasattr(self.driver,'scroll'), 'Guarded wheel navigation is not implemented')
        lease=self.begin()
        self.api.before_send=lambda api,events:setattr(api,'external_sequence',api.external_sequence+1)
        self.fails('input-interrupted',self.driver.scroll,lease,20,30,-120)
        self.assertFalse(self.api.wheels)


class InputTrackerTests(unittest.TestCase):
    def sender(self):
        import ctypes as c
        from types import SimpleNamespace
        class Mouse(c.Structure):
            _fields_=[('dx',c.c_int32),('dy',c.c_int32),('mouseData',c.c_uint32),('dwFlags',c.c_uint32),('time',c.c_uint32),('dwExtraInfo',c.c_size_t)]
        class Keyboard(c.Structure):
            _fields_=[('wVk',c.c_uint16),('wScan',c.c_uint16),('dwFlags',c.c_uint32),('time',c.c_uint32),('dwExtraInfo',c.c_size_t)]
        class Union(c.Union): _fields_=[('mi',Mouse),('ki',Keyboard)]
        class Input(c.Structure): _anonymous_=('data',);_fields_=[('type',c.c_uint32),('data',Union)]
        sent=[]
        def send(count,values,size):
            for item in values:
                payload=item.mi if item.type==0 else item.ki
                sent.append({'type':item.type,'flags':payload.dwFlags,'tag':payload.dwExtraInfo,
                             'data':item.mi.mouseData if item.type==0 else item.ki.wVk})
            return count
        api=native._WindowsAPI.__new__(native._WindowsAPI)
        api.c=c;api.INPUT=Input;api._input_tag=1234;api._watch=None
        api._enter_dpi=lambda:None;api._exit_dpi=lambda old:None;api.now=lambda:123
        api.u=SimpleNamespace(GetSystemMetrics=lambda index:{76:0,77:0,78:1920,79:1080}[index],SendInput=send)
        return api,sent

    def test_cleanup_release_remains_possible_if_hook_watch_died(self):
        api,sent=self.sender()
        api.send_input([('left_up',)])
        api.send_input([('key_up','ESC')])
        self.assertEqual(sent,[{'type':0,'flags':4,'tag':1234,'data':0},
                               {'type':1,'flags':2,'tag':1234,'data':27}])
        with self.assertRaises(native.NativeError): api.send_input([('left_down',)])

    def test_native_wheel_uses_signed_data_and_same_own_event_tag(self):
        from types import SimpleNamespace
        api,sent=self.sender()
        tracker=native._InputTracker(1234)
        api._watch=SimpleNamespace(sequence=lambda:0,tracker=tracker)
        api.send_input([('wheel',-120)],expected_sequence=0)
        self.assertEqual(sent,[{'type':0,'flags':0x0800,'tag':1234,'data':4294967176}])

    def test_own_tag_needs_injected_flag_and_external_events_keep_monotonic_sequence(self):
        self.assertTrue(hasattr(native,'_InputTracker'), 'External input tracker is not implemented')
        tracker=native._InputTracker(1234)
        self.assertTrue(tracker.observe(True,1234))
        self.assertEqual(tracker.sequence,0)
        self.assertTrue(tracker.observe(False,1234))
        self.assertEqual(tracker.sequence,1)
        self.assertTrue(tracker.observe(True,5678))
        self.assertEqual(tracker.sequence,2)
    def test_external_event_blocks_stale_injected_down_but_allows_release(self):
        self.assertTrue(hasattr(native,'_InputTracker'), 'External input tracker is not implemented')
        tracker=native._InputTracker(1234)
        tracker.arm(0)
        tracker.observe(False,0)
        self.assertFalse(tracker.observe(True,1234))
        self.assertTrue(tracker.observe(True,1234,release=True))
        with self.assertRaises(native.NativeError) as got: tracker.arm(0)
        self.assertEqual(got.exception.code,'input-interrupted')
    def test_hook_callback_blocks_stale_mouse_and_keyboard_but_passes_external_and_release(self):
        import ctypes as c
        from types import SimpleNamespace
        class Event(c.Structure): _fields_=[('flags',c.c_uint32),('dwExtraInfo',c.c_size_t)]
        api=SimpleNamespace(c=c,MOUSEHOOK=Event,KEYBOARDHOOK=Event,
                            u=SimpleNamespace(CallNextHookEx=lambda *args:73))
        watch=native._LowLevelInputWatch(api,1234)
        external=Event(0,0)
        self.assertEqual(watch._callback(False,0,0x0200,c.addressof(external)),73)
        self.assertEqual(watch.tracker.sequence,1)
        own_mouse=Event(1,1234)
        self.assertEqual(watch._callback(False,0,0x0201,c.addressof(own_mouse)),1)
        self.assertEqual(watch._callback(False,0,0x0202,c.addressof(own_mouse)),73)
        own_key=Event(0x10,1234)
        self.assertEqual(watch._callback(True,0,0x0100,c.addressof(own_key)),1)
        self.assertEqual(watch._callback(True,0,0x0101,c.addressof(own_key)),73)
        self.assertEqual(watch._callback(False,-1,0,0),73)
    def test_partial_hook_start_failure_unhooks_installed_hook_and_fails_closed(self):
        import ctypes as c
        from types import SimpleNamespace
        class Message(c.Structure): _fields_=[('unused',c.c_uint32)]
        calls=[]
        def install(kind,callback,module,thread):
            calls.append(('install',kind))
            return 101 if kind==14 else 0
        api=SimpleNamespace(c=c,w=SimpleNamespace(MSG=Message),HOOKPROC=lambda callback:callback,
            k=SimpleNamespace(GetCurrentThreadId=lambda:123,GetModuleHandleW=lambda unused:99),
            u=SimpleNamespace(PeekMessageW=lambda *args:False,SetWindowsHookExW=install,
                UnhookWindowsHookEx=lambda handle:calls.append(('remove',handle)),PostThreadMessageW=lambda *args:True))
        watch=native._LowLevelInputWatch(api,1234)
        with self.assertRaises(native.NativeError) as got: watch.start()
        self.assertEqual(got.exception.code,'input-watch-unavailable')
        self.assertEqual(calls,[('install',14),('install',13),('remove',101)])
        self.assertFalse(watch.thread.is_alive())

if __name__=='__main__': unittest.main()
