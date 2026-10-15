"""Fixed, local Bing article reader for the paired Phone Link phone window.

Only calibrated profile, saved-account and Rewards screens are navigated. Images
and OCR results are transient; only validated article observations reach Store.
This module is the delivered application integration, with injectable boundaries
for tests; it exposes no generic input or arbitrary screen-capture endpoint.
"""
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import re
import threading
import time

try:
    from .phone_native import NativeError, WindowDriver
    from .phone_vision import Bitmap, OcrClient, find_template, match_at, unique_profile, parse_article_ratio, prepare_article_counter
except ImportError:
    from phone_native import NativeError, WindowDriver
    from phone_vision import Bitmap, OcrClient, find_template, match_at, unique_profile, parse_article_ratio, prepare_article_counter


PHONE_REASONS=frozenset((
    'target-unavailable','target-invalid','target-ambiguous','desktop-locked',
    'desktop-busy','input-interrupted','target-changed','target-covered',
    'target-not-foreground','lease-expired','lease-invalid','lease-busy',
    'invalid-coordinate','invalid-key','invalid-scroll','invalid-idle',
    'invalid-timeout','input-failed','capture-failed','platform-unavailable',
    'input-watch-unavailable','input-unavailable','calibration-needed',
    'interrupted','unreadable','account-unavailable','rewards-loading-timeout',
))


class ReaderError(RuntimeError):
    def __init__(self, code):
        self.code=code
        super().__init__(code)


def _day(stamp):
    now=datetime.fromtimestamp(stamp/1000,timezone.utc)
    def sunday(month):
        last=datetime(now.year,month+1,1,tzinfo=timezone.utc)-timedelta(days=1)
        return (last-timedelta(days=(last.weekday()+1)%7)).replace(hour=1)
    summer=sunday(3)<=now<sunday(10)
    return (now+timedelta(hours=2 if summer else 1)).date().isoformat()


def _rect(value, width, height, search=False):
    if not isinstance(value,(tuple,list)) or len(value)!=4 or any(type(v) is not int for v in value):
        raise ReaderError('calibration-needed')
    x,y,a,b=value
    if search:
        valid=0<=x<a<=width and 0<=y<b<=height
    else:
        valid=0<=x<width and 0<=y<height and 0<a<=width-x and 0<b<=height-y
    if not valid:raise ReaderError('calibration-needed')
    return tuple(value)


def load_calibration(path, accounts):
    """Load private, relative BMP references, bound to all three current emails.

    Schema v1 uses canonical 357x813 physical-window pixels. profile.rect is
    (x,y,w,h); searchBounds is exclusive (left,top,right,bottom). Anchor click
    and article.counterRect are relative to the matching template's top-left.
    """
    path=Path(path)
    try:
        if path.stat().st_size>65536:raise ReaderError('calibration-needed')
        raw=json.loads(path.read_text(encoding='utf-8-sig'))
        if raw.get('version')!=1 or raw.get('width')!=357 or raw.get('height')!=813:raise ReaderError('calibration-needed')
        title=raw.get('windowTitle')
        if not isinstance(title,str) or not title or len(title)>256 or '\x00' in title:raise ReaderError('calibration-needed')
        configured={a['slot']:(a.get('email') or '').strip().casefold() for a in accounts}
        loaded={'windowTitle':title,'width':357,'height':813,'identities':[],'anchors':{},'navigation':{}}
        def reference(source, profile=False):
            if not isinstance(source,dict):raise ReaderError('calibration-needed')
            name=source.get('path')
            if not isinstance(name,str) or not name or Path(name).is_absolute():raise ReaderError('calibration-needed')
            target=(path.parent/name).resolve()
            if not target.is_relative_to(path.parent.resolve()) or target.suffix.casefold()!='.bmp' or target.stat().st_size>2000000:raise ReaderError('calibration-needed')
            bitmap=Bitmap.from_bmp(target.read_bytes())
            out={'bitmap':bitmap,'minimum':.93}
            if 'rect' in source:
                out['rect']=_rect(source['rect'],357,813)
                if out['rect'][2:]!=(bitmap.width,bitmap.height):raise ReaderError('calibration-needed')
            elif 'searchBounds' in source and not profile:
                out['searchBounds']=_rect(source['searchBounds'],357,813,True)
            else:raise ReaderError('calibration-needed')
            if 'click' in source:
                click=source['click']
                if not isinstance(click,(list,tuple)) or len(click)!=2 or any(type(v) is not int for v in click) or not 0<=click[0]<bitmap.width or not 0<=click[1]<bitmap.height:raise ReaderError('calibration-needed')
                out['click']=tuple(click)
            if 'counterRect' in source:
                rel=source['counterRect']
                if not isinstance(rel,(list,tuple)) or len(rel)!=4 or any(type(v) is not int for v in rel) or not -357<rel[0]<357 or not -813<rel[1]<813 or not 1<=rel[2]<=160 or not 1<=rel[3]<=80:raise ReaderError('calibration-needed')
                out['counterRect']=tuple(rel)
            return out
        identities=raw.get('identities')
        if not isinstance(identities,list) or len(identities)!=3:raise ReaderError('calibration-needed')
        seen=set()
        for identity in identities:
            slot=identity.get('slot');email=identity.get('email')
            if type(slot) is not int or slot not in (1,2,3) or slot in seen or not isinstance(email,str):raise ReaderError('calibration-needed')
            email=email.strip().casefold()
            if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',email) or configured.get(slot)!=email:raise ReaderError('calibration-needed')
            seen.add(slot)
            loaded['identities'].append({'slot':slot,'email':email,'profile':reference(identity['profile'],True),'row':reference(identity['row'])})
        if len({i['email'] for i in loaded['identities']})!=3:raise ReaderError('calibration-needed')
        anchors=raw.get('anchors',{})
        for name in ('rewards','accounts','switch','article','back','rewardsPage'):
            if name in anchors:loaded['anchors'][name]=reference(anchors[name])
        if not {'rewards','accounts','switch','article','back'}.issubset(loaded['anchors']) or 'counterRect' not in loaded['anchors']['article']:raise ReaderError('calibration-needed')
        navigation=raw.get('navigation',{})
        point=navigation.get('profileAccountClick',[140,163])
        if not isinstance(point,(list,tuple)) or len(point)!=2 or any(type(v) is not int for v in point) or not 0<=point[0]<357 or not 0<=point[1]<813:raise ReaderError('calibration-needed')
        loaded['navigation']['profileAccountClick']=tuple(point)
        for key,default,limit in [('maxAccountSwipes',10,10),('maxArticleSwipes',3,5)]:
            value=navigation.get(key,default)
            if type(value) is not int or not 0<=value<=limit:raise ReaderError('calibration-needed')
            loaded['navigation'][key]=value
        return loaded
    except ReaderError:raise
    except Exception:raise ReaderError('calibration-needed') from None


class PhoneReader:
    def __init__(self,store,calibration_path,driver=None,ocr=None,clock=None,sleeper=None):
        self.store=store;self.calibration_path=Path(calibration_path)
        self.driver=driver;self.ocr=ocr or OcrClient()
        self._clock=clock or (lambda:int(time.time()*1000));self._sleep=sleeper or time.sleep
        self._stop=threading.Event();self._thread=None;self._cycle_lock=threading.Lock();self._next_attempt=0;self.calibration=None

    def _status(self,status,slot=None,cycle=None,reason=None):
        body={'status':status,'slot':slot,'reason':reason if reason in PHONE_REASONS else None}
        if cycle is not None:body['lastCycleAt']=cycle
        try:self.store.apply('/api/phone/status',body)
        except Exception:pass

    def _enabled(self):return bool(self.store.view().get('phoneReader',{}).get('enabled'))

    def _check(self):
        if self._stop.is_set() or not self._enabled():raise ReaderError('interrupted')

    def _capture(self,lease):
        self._check()
        raw=self.driver.capture(lease)
        bitmap=raw if isinstance(raw,Bitmap) else Bitmap(**raw)
        return bitmap.resized(357,813) if (bitmap.width,bitmap.height)!=(357,813) else bitmap

    def _match(self,frame,ref):
        if 'rect' in ref:
            found=match_at(frame,ref['bitmap'],ref['rect'][0],ref['rect'][1])
            return found if found and found['score']>=ref['minimum'] else None
        return find_template(frame,ref['bitmap'],ref['searchBounds'],minimum=ref['minimum'])

    def _anchor(self,frame,name):
        ref=self.calibration['anchors'].get(name)
        return self._match(frame,ref) if ref else None

    def _profile(self,frame):
        refs=[{'slot':item['slot'],'email':item['email'],'bitmap':item['profile']['bitmap'],'rect':item['profile']['rect']} for item in self.calibration['identities']]
        return unique_profile(frame,refs,minScore=.93,minMargin=.12)

    def _point(self,lease,x,y):
        bounds=lease.window.bounds
        width,height=bounds[2]-bounds[0],bounds[3]-bounds[1]
        return min(width-1,max(0,round(x*width/357))),min(height-1,max(0,round(y*height/813)))

    def _click(self,lease,found,ref):
        self._check()
        dx,dy=ref.get('click',(ref['bitmap'].width//2,ref['bitmap'].height//2))
        x,y=found['rect'][:2]
        self.driver.click(lease,*self._point(lease,x+dx,y+dy))
        self._sleep(.65)

    def _wait_profile(self,lease,slot=None):
        seen_other=False
        for _ in range(6):
            frame=self._capture(lease);profile=self._profile(frame)
            if profile:
                if slot is None or profile['slot']==slot:return frame,profile
                seen_other=True  # Account switching may briefly retain old text.
            self._sleep(.5)
        raise ReaderError('account-unavailable' if seen_other else 'unreadable')

    def _rewards_known(self,frame):return bool(self._anchor(frame,'article') or self._anchor(frame,'rewardsPage'))

    def _wait_rewards(self,lease):
        # Loading and transition frames authorize no input. The bounded passive
        # wait lets a slow Rewards page appear, then normal recognition resumes.
        for index in range(13):
            frame=self._capture(lease)
            if self._rewards_known(frame):return frame
            if index<12:self._sleep(.5)
        raise ReaderError('rewards-loading-timeout')

    def _back_from_rewards(self,lease):
        frame=self._capture(lease)
        if not self._rewards_known(frame):raise ReaderError('unreadable')
        found=self._anchor(frame,'back')
        if not found:raise ReaderError('unreadable')
        self._click(lease,found,self.calibration['anchors']['back'])

    def _article(self,lease):
        previous=None
        for index in range(self.calibration['navigation']['maxArticleSwipes']+1):
            frame=self._capture(lease);found=self._anchor(frame,'article')
            if found:return frame,found
            if not self._rewards_known(frame):raise ReaderError('unreadable')
            digest=hashlib.sha256(frame.crop((0,90,357,640)).bgra).digest()
            if (digest==previous and index>1) or index==self.calibration['navigation']['maxArticleSwipes']:break
            previous=digest
            if index==0:
                self.driver.scroll(lease,*self._point(lease,240,599),delta=-120)
            else:
                self.driver.key(lease,'PAGEDOWN')
            self._sleep(.65)
        raise ReaderError('unreadable')

    def _ratio(self,frame,found):
        dx,dy,width,height=self.calibration['anchors']['article']['counterRect'];x,y=found['rect'][:2]
        try:
            result=self.ocr.read(prepare_article_counter(frame.crop((x+dx,y+dy,width,height))),scale=3)
            lines=result.get('lines',[])
            if not isinstance(lines,list) or len(lines)>4:raise ReaderError('unreadable')
            value=parse_article_ratio(' '.join(line['text'] for line in lines))
        except Exception:raise ReaderError('unreadable') from None
        if value is None:raise ReaderError('unreadable')
        return value

    def _observe(self,lease,slot):
        frame,before=self._wait_profile(lease,slot)
        before_day=_day(self._clock())
        found=self._anchor(frame,'rewards')
        if not found:raise ReaderError('unreadable')
        self._click(lease,found,self.calibration['anchors']['rewards'])
        self._wait_rewards(lease)
        frame,article=self._article(lease);first=self._ratio(frame,article)
        self._sleep(.7)
        frame,article=self._article(lease);observed=self._clock();second=self._ratio(frame,article)
        if first!=second:raise ReaderError('unreadable')
        self._back_from_rewards(lease)
        _,after=self._wait_profile(lease,slot)
        if before['email']!=after['email'] or before['slot']!=after['slot']:raise ReaderError('account-unavailable')
        if _day(observed)!=before_day or _day(self._clock())!=before_day:raise ReaderError('unreadable')
        self._check()
        self.store.apply('/api/phone/observation',{'slot':slot,'expectedEmail':before['email'],'beforeEmail':before['email'],'afterEmail':after['email'],'date':before_day,'observedAt':observed,'earned':second,'total':30})

    def _row(self,frame,slot):
        target=next(item for item in self.calibration['identities'] if item['slot']==slot)
        ref=target['row'];found=self._match(frame,ref)
        if not found:return None
        # Compare every calibrated identity at the candidate row location. Other
        # saved rows elsewhere do not count as ambiguity; lookalikes here do.
        x,y=found['rect'][:2]
        refs=[{'slot':item['slot'],'email':item['email'],'bitmap':item['row']['bitmap'],'rect':(x,y,item['row']['bitmap'].width,item['row']['bitmap'].height)} for item in self.calibration['identities']]
        unique=unique_profile(frame,refs,minScore=.93,minMargin=.12)
        if not unique or unique['slot']!=slot:return None
        return found,ref

    def _find_row(self,lease,slot):
        limit=self.calibration['navigation']['maxAccountSwipes']
        for direction in (1,-1):
            previous=None
            for index in range(limit+1):
                frame=self._capture(lease)
                if not self._anchor(frame,'accounts'):raise ReaderError('unreadable')
                row=self._row(frame,slot)
                if row:return row
                digest=hashlib.sha256(frame.crop((30,230,300,480)).bgra).digest()
                if digest==previous or index==limit:break
                previous=digest
                start,end=(638,312) if direction==1 else (312,638)
                self.driver.drag(lease,*self._point(lease,285,start),*self._point(lease,285,end));self._sleep(.65)
        raise ReaderError('account-unavailable')

    def _switch(self,lease,slot):
        frame,current=self._wait_profile(lease)
        if current['slot']==slot:return
        self._check()
        self.driver.click(lease,*self._point(lease,*self.calibration['navigation']['profileAccountClick']));self._sleep(.65)
        found,ref=self._find_row(lease,slot)
        self._click(lease,found,ref)
        frame=self._capture(lease);button=self._anchor(frame,'switch')
        if not button:raise ReaderError('unreadable')
        self._click(lease,button,self.calibration['anchors']['switch'])
        self._wait_profile(lease,slot)

    def _restore(self,lease,original):
        # Best effort uses exactly the same recognized-screen constraints. An
        # interrupted native lease rejects even capture, so no further input.
        try:
            frame=self._capture(lease);profile=self._profile(frame)
            if not profile and self._rewards_known(frame):
                self._back_from_rewards(lease);_,profile=self._wait_profile(lease)
            if profile and profile['slot']!=original:self._switch(lease,original)
        except Exception:pass

    @staticmethod
    def _reason(error):
        if isinstance(error,(NativeError,ReaderError)):
            code=getattr(error,'code',None)
            return code if isinstance(code,str) and code in PHONE_REASONS else None
        return None

    @staticmethod
    def _error_status(error):
        code=PhoneReader._reason(error)
        if code in ('desktop-busy',):return 'waiting-idle'
        if code in ('input-interrupted','interrupted','lease-invalid','lease-expired','target-not-foreground'):return 'interrupted'
        if code in ('target-unavailable','target-invalid','desktop-locked','target-covered','target-changed','platform-unavailable'):return 'waiting-phone'
        if code=='rewards-loading-timeout':return 'unreadable'
        if code in ('calibration-needed','account-unavailable','unreadable'):return code
        return 'error'

    def run_cycle(self):
        if not self._cycle_lock.acquire(False):return False
        lease=None;original=None;success=False;current_slot=None
        try:
            if not self._enabled():self._status('off');return False
            self._check()
            self.calibration=load_calibration(self.calibration_path,self.store.view()['accounts'])
            if self.driver is None:self.driver=WindowDriver(lease_timeout_ms=240000)
            window=self.driver.find(self.calibration['windowTitle']);self._check();lease=self.driver.begin(window,idle_ms=15000)
            _,profile=self._wait_profile(lease);original=profile['slot']
            order=[original]+[slot for slot in (1,2,3) if slot!=original]
            for slot in order:
                current_slot=slot
                self._check();self._status('reading',slot)
                self._switch(lease,slot);self._observe(lease,slot)
            self._switch(lease,original)
            success=True;self._status('ready',cycle=self._clock())
            return True
        except Exception as error:
            self._status(self._error_status(error),slot=current_slot,reason=self._reason(error))
            return False
        finally:
            if lease is not None:
                if original is not None and not success:self._restore(lease,original)
                try:self.driver.finish(lease)
                except Exception:pass
            self._cycle_lock.release()

    def poll_once(self):
        now=self._clock()
        if not self._enabled():
            if self.store.view().get('phoneReader',{}).get('status')!='off':self._status('off')
            self._next_attempt=0
            return False
        if now<self._next_attempt:return False
        success=self.run_cycle()
        status=self.store.view().get('phoneReader',{}).get('status')
        self._next_attempt=self._clock()+(5000 if status=='waiting-idle' else 120000)
        return success

    def _run(self):
        while not self._stop.is_set():
            self.poll_once()
            self._stop.wait(1)

    def start(self):
        if self._thread is not None and self._thread.is_alive():return
        self._stop.clear()
        self._thread=threading.Thread(target=self._run,name='RewardsPhoneReader',daemon=True);self._thread.start()

    def stop(self,timeout=25):
        self._stop.set()
        thread=self._thread
        if thread is not None and thread is not threading.current_thread():thread.join(timeout)
