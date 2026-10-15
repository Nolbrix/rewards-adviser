"""Fixed phone-reader tests: synthetic pixels, real matching, no real UI."""
import importlib.util
import json
from pathlib import Path
import random
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest

BASE=Path(__file__).parents[1]
sys.path.insert(0,str(BASE/'companion'))
from phone_vision import Bitmap
from server import Store, day_key
from phone_native import NativeError
try:
    import phone_reader as reader_module
except ModuleNotFoundError:
    reader_module=None


def pattern(seed,width=34,height=14):
    rng=random.Random(seed)
    return Bitmap(width,height,b''.join(bytes((0,0,0,255) if rng.random()<.38 else (255,255,255,255)) for _ in range(width*height)))


def canvas(items):
    pixels=bytearray(bytes((255,255,255,255))*357*813)
    for image,x,y in items:
        for row in range(image.height):
            at=((y+row)*357+x)*4
            pixels[at:at+image.width*4]=image.bgra[row*image.width*4:(row+1)*image.width*4]
    return Bitmap(357,813,pixels)


class ScriptedDriver:
    def __init__(self,templates):
        self.templates=templates;self.current=1;self.screen='profile';self.pending=None
        self.actions=[];self.frames=0;self.fail_input=False;self.changed_after_read=False
        self.hidden_mode=False;self.article_hidden=False;self.wheeled=False;self.unknown_after_wheel=False
        self.profile_delay=0;self.delayed_target=None;self.delay_left=0
        self.rewards_delay=0;self.rewards_wait=0
        self.lease=SimpleNamespace(window=SimpleNamespace(bounds=(0,0,357,813)))
    def find(self,title):
        if title!='Galaxy A35':raise NativeError('target-unavailable')
        return self.lease.window
    def begin(self,window,idle_ms=15000):return self.lease
    def finish(self,lease):self.actions.append(('finish',self.current))
    def capture(self,lease):
        self.frames+=1
        if self.fail_input:raise NativeError('input-interrupted')
        t=self.templates
        if self.screen=='rewards' and self.rewards_wait:
            self.rewards_wait-=1
            blank=canvas([]);return {'width':blank.width,'height':blank.height,'bgra':blank.bgra}
        if self.screen=='profile' and self.delayed_target is not None:
            if self.delay_left:self.delay_left-=1
            else:self.current=self.delayed_target;self.delayed_target=None
        if self.screen=='profile':image=canvas([(t['profile'+str(self.current)],75,126),(t['rewards'],90,230)])
        elif self.screen=='accounts':image=canvas([(t['accounts'],10,70),(t['back'],10,45)]+[(t['row'+str(slot)],80,200+slot*100) for slot in (1,2,3)])
        elif self.screen=='confirm':image=canvas([(t['switch'],130,650)])
        elif self.screen=='rewards':image=canvas(([] if self.article_hidden else [(t['article'],30,400)])+[(t['back'],10,45),(t['rewardsPage'],90,70)])
        else:image=canvas([])
        return {'width':image.width,'height':image.height,'bgra':image.bgra}
    def click(self,lease,x,y):
        self.actions.append((self.screen,x,y))
        if self.screen=='profile' and 125<=y<=180:self.screen='accounts'
        elif self.screen=='profile' and 225<=y<=250:self.screen='rewards';self.article_hidden=self.hidden_mode;self.wheeled=False;self.rewards_wait=self.rewards_delay
        elif self.screen=='accounts' and 300<=y<=515:
            self.pending=round((y-200)/100);self.screen='confirm'
        elif self.screen=='confirm' and 645<=y<=675:
            self.screen='profile'
            if self.profile_delay:self.delayed_target=self.pending;self.delay_left=self.profile_delay
            else:self.current=self.pending
        elif self.screen in ('accounts','rewards') and 40<=y<=65:
            if self.changed_after_read and self.screen=='rewards':self.current=2
            self.screen='profile'
        else:raise AssertionError('Unsafe or unexpected synthetic click')
    def drag(self,*args):self.actions.append(('drag',));raise AssertionError('Unexpected synthetic swipe')
    def scroll(self,lease,x,y,delta=120):
        if self.screen!='rewards' or delta!=-120:raise AssertionError('Unsafe synthetic wheel')
        self.actions.append(('wheel',));self.wheeled=True
        if self.unknown_after_wheel:self.screen='unknown'
    def key(self,lease,name):
        if self.screen!='rewards' or name!='PAGEDOWN' or not self.wheeled:raise AssertionError('Unsafe synthetic key')
        self.actions.append(('PAGEDOWN',));self.article_hidden=False


class OCR:
    def __init__(self,driver):self.driver=driver;self.reads=0;self.values={1:'0/30',2:'12/30',3:'30/30'};self.hook=None
    def read(self,bitmap,scale=3):
        self.reads+=1
        if self.hook:self.hook(self)
        return {'width':bitmap.width,'height':bitmap.height,'lines':[{'text':self.values[self.driver.current],'words':[]}]}


class ReaderTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(reader_module,'Fixed reader not implemented')
        self.temp=tempfile.TemporaryDirectory();self.base=Path(self.temp.name)
        self.store=Store(self.base/'state')
        self.emails={slot:f'reader{slot}@example.com' for slot in (1,2,3)}
        for slot,email in self.emails.items():self.store.apply('/api/heartbeat',{'clientId':f'reader-{slot}','config':{'slot':slot,'email':email}})
        self.store.apply('/api/phone/settings',{'enabled':True})
        self.templates={name:pattern(i+1) for i,name in enumerate(['profile1','profile2','profile3','row1','row2','row3','rewards','accounts','switch','article','back','rewardsPage'])}
        for name,image in self.templates.items():(self.base/(name+'.bmp')).write_bytes(image.to_bmp())
        self.config={'version':1,'windowTitle':'Galaxy A35','width':357,'height':813,'identities':[{'slot':slot,'email':self.emails[slot],'profile':{'path':f'profile{slot}.bmp','rect':[75,126,34,14]},'row':{'path':f'row{slot}.bmp','searchBounds':[78,292,118,522]}} for slot in (1,2,3)],'anchors':{},'navigation':{'profileAccountClick':[140,163],'maxAccountSwipes':0,'maxArticleSwipes':0}}
        for name,x,y in [('rewards',90,230),('accounts',10,70),('switch',130,650),('article',30,400),('back',10,45),('rewardsPage',90,70)]:
            self.config['anchors'][name]={'path':name+'.bmp','rect':[x,y,34,14],'click':[10,7]}
        self.config['anchors']['article']['counterRect']=[150,0,55,20]
        self.path=self.base/'calibration.json';self.save()
        self.driver=ScriptedDriver(self.templates);self.ocr=OCR(self.driver)
        self.now=int(time.time()*1000)
        self.reader=reader_module.PhoneReader(self.store,self.path,driver=self.driver,ocr=self.ocr,clock=lambda:self.now,sleeper=lambda seconds:None)
    def tearDown(self):
        if hasattr(self,'reader'):self.reader.stop()
        if hasattr(self,'temp'):self.temp.cleanup()
    def save(self):self.path.write_text(json.dumps(self.config),encoding='utf-8')
    def test_cycle_reads_all_accounts_and_restores_original(self):
        self.assertTrue(self.reader.run_cycle())
        readings=[a['phoneReading'] for a in self.store.view()['accounts']]
        self.assertEqual([x['earned'] for x in readings],[0,12,30])
        self.assertTrue(all(x['source']=='phone-screen' and x['date']==day_key() for x in readings))
        self.assertEqual(self.driver.current,1)
        self.assertEqual(self.store.view()['phoneReader']['status'],'ready')
        self.assertEqual(self.ocr.reads,6)
    def test_unknown_screen_never_clicks_and_does_not_write_zero(self):
        self.driver.screen='unknown';self.assertFalse(self.reader.run_cycle())
        self.assertEqual([a['phoneReading'] for a in self.store.view()['accounts']],[None]*3)
        self.assertTrue(all(x[0]=='finish' for x in self.driver.actions))
    def test_changed_identity_after_reading_never_publishes(self):
        self.driver.changed_after_read=True
        self.assertFalse(self.reader.run_cycle())
        self.assertIsNone(self.store.view()['accounts'][0]['phoneReading'])
    def test_ambiguous_counter_or_nonstable_repeat_never_publishes(self):
        self.ocr.values[1]='0/30 12/30';self.assertFalse(self.reader.run_cycle())
        self.assertIsNone(self.store.view()['accounts'][0]['phoneReading'])
        self.driver.screen='profile';self.ocr.values[1]='0/30'
        self.ocr.hook=lambda o:o.values.update({1:'3/30' if o.reads%2==0 else '0/30'})
        self.assertFalse(self.reader.run_cycle());self.assertIsNone(self.store.view()['accounts'][0]['phoneReading'])
    def test_cross_midnight_is_rejected_before_publish(self):
        original=self.now
        def advance(ocr):
            if ocr.reads==2:self.reader._clock=lambda:original+86400000
        self.ocr.hook=advance
        self.assertFalse(self.reader.run_cycle());self.assertIsNone(self.store.view()['accounts'][0]['phoneReading'])
    def test_external_input_stops_without_more_navigation(self):
        self.ocr.hook=lambda o:setattr(self.driver,'fail_input',True)
        self.assertFalse(self.reader.run_cycle())
        self.assertEqual(self.store.view()['phoneReader']['status'],'interrupted')
        self.assertFalse(any(action[0] in ('accounts','confirm') for action in self.driver.actions))
    def test_all_three_calibrations_and_current_email_binding_are_required(self):
        self.config['identities'].pop();self.save()
        self.assertFalse(self.reader.run_cycle());self.assertEqual(self.driver.frames,0)
        self.assertEqual(self.store.view()['phoneReader']['status'],'calibration-needed')
    def test_rewards_loading_waits_passively_for_a_recognized_screen(self):
        self.driver.rewards_delay=3
        self.assertTrue(self.reader.run_cycle())
        self.assertEqual([a['phoneReading']['earned'] for a in self.store.view()['accounts']],[0,12,30])
    def test_rewards_loading_timeout_never_sends_navigation_to_unknown_screen(self):
        self.driver.rewards_delay=100
        captured=[];apply=self.store.apply
        def record(route,body):
            if route=='/api/phone/status':captured.append(dict(body))
            return apply(route,body)
        self.store.apply=record
        self.assertFalse(self.reader.run_cycle())
        self.assertFalse(any(a[0] in ('wheel','PAGEDOWN','rewards','accounts','confirm') for a in self.driver.actions))
        self.assertEqual(captured[-1].get('reason'),'rewards-loading-timeout')
        self.assertIsNone(self.store.view()['accounts'][0]['phoneReading'])
    def test_failure_status_preserves_the_account_currently_being_read(self):
        captured=[];apply=self.store.apply
        def record(route,body):
            if route=='/api/phone/status':captured.append(dict(body))
            return apply(route,body)
        self.store.apply=record;self.ocr.values[3]='noise'
        self.assertFalse(self.reader.run_cycle())
        self.assertEqual(captured[-1]['status'],'unreadable')
        self.assertEqual(captured[-1]['slot'],3)
        self.assertEqual([a['phoneReading']['earned'] if a['phoneReading'] else None for a in self.store.view()['accounts']],[0,12,None])
    def test_reason_is_bounded_typed_and_cleared_after_recovery(self):
        captured=[];apply=self.store.apply
        def record(route,body):
            if route=='/api/phone/status':captured.append(dict(body))
            return apply(route,body)
        self.store.apply=record
        self.driver.find=lambda title:(_ for _ in ()).throw(NativeError('target-covered'))
        self.assertFalse(self.reader.run_cycle());self.assertEqual(captured[-1].get('reason'),'target-covered')
        self.driver.find=lambda title:(_ for _ in ()).throw(RuntimeError('secret@example.com'))
        self.assertFalse(self.reader.run_cycle());self.assertIsNone(captured[-1].get('reason'))
        self.assertNotIn('secret',json.dumps(captured))
        self.reader._status('reading');self.assertIn('reason',captured[-1]);self.assertIsNone(captured[-1]['reason'])
    def test_delayed_account_transition_waits_for_target_without_more_clicks(self):
        self.driver.profile_delay=2
        self.assertTrue(self.reader.run_cycle())
        self.assertEqual(self.driver.current,1)
        self.assertEqual([a['phoneReading']['earned'] for a in self.store.view()['accounts']],[0,12,30])
    def test_article_navigation_uses_guarded_wheel_then_page_down(self):
        self.config['navigation']['maxArticleSwipes']=3;self.save();self.driver.hidden_mode=True
        self.assertTrue(self.reader.run_cycle())
        self.assertEqual(sum(a[0]=='wheel' for a in self.driver.actions),3)
        self.assertEqual(sum(a[0]=='PAGEDOWN' for a in self.driver.actions),3)
    def test_unexpected_screen_after_wheel_does_not_receive_page_down(self):
        self.config['navigation']['maxArticleSwipes']=3;self.save();self.driver.hidden_mode=True;self.driver.unknown_after_wheel=True
        self.assertFalse(self.reader.run_cycle())
        self.assertFalse(any(a[0]=='PAGEDOWN' for a in self.driver.actions))
        self.assertIsNone(self.store.view()['accounts'][0]['phoneReading'])
    def test_calibration_cannot_escape_private_folder_or_bind_a_different_email(self):
        self.config['identities'][0]['email']='stranger@example.com';self.save()
        self.assertFalse(self.reader.run_cycle());self.assertEqual(self.driver.frames,0)
        self.config['identities'][0]['email']=self.emails[1]
        self.config['anchors']['article']['path']='../outside.bmp';self.save()
        self.assertFalse(self.reader.run_cycle());self.assertEqual(self.driver.frames,0)
    def test_idle_wait_does_not_navigate_and_retries_without_chat(self):
        original=self.driver.begin
        self.driver.begin=lambda *args,**kwargs:(_ for _ in ()).throw(NativeError('desktop-busy'))
        self.assertFalse(self.reader.poll_once());self.assertEqual(self.driver.actions,[])
        self.assertEqual(self.store.view()['phoneReader']['status'],'waiting-idle')
        self.driver.begin=original;self.now+=5001
        import unittest.mock
        with unittest.mock.patch('server.time.time',return_value=self.now/1000):self.assertTrue(self.reader.poll_once())
    def test_pause_between_samples_stops_and_preserves_other_manual_tasks(self):
        self.store.apply('/api/manual',{'slot':1,'activities':[{'id':'check-in','title':'Check in','total':10,'status':'complete'}]})
        self.ocr.hook=lambda o:self.store.apply('/api/phone/settings',{'enabled':False})
        self.assertFalse(self.reader.run_cycle())
        state=self.store.view();self.assertIsNone(state['accounts'][0]['phoneReading'])
        self.assertEqual(state['accounts'][0]['manual'][0]['earned'],10)
        self.assertEqual(state['phoneReader']['status'],'off')
    def test_scheduled_second_cycle_without_chat_and_pause(self):
        self.assertTrue(self.reader.poll_once());first=self.ocr.reads
        self.assertFalse(self.reader.poll_once());self.assertEqual(self.ocr.reads,first)
        self.now+=120001
        # Store's own wall-clock freshness guard also advances in this test.
        import unittest.mock
        with unittest.mock.patch('server.time.time',return_value=self.now/1000):self.assertTrue(self.reader.poll_once())
        self.assertEqual(self.ocr.reads,first+6)
        self.store.apply('/api/phone/settings',{'enabled':False});self.now+=120001
        self.assertFalse(self.reader.poll_once());self.assertEqual(self.ocr.reads,first+6)

if __name__=='__main__':unittest.main()
