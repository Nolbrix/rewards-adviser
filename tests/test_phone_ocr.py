import base64
import json
import os
from pathlib import Path
import shutil
import subprocess
import unittest
from unittest import mock

try:
    from companion import phone_vision as vision
except ImportError:
    vision = None


class OcrClientTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(vision, 'Windows OCR client is not implemented')

    def test_subprocess_failure_and_timeout_do_not_expose_raw_image_or_exception(self):
        image = vision.Bitmap(1, 1, b'\xff\xff\xff\xff')
        failures = [subprocess.TimeoutExpired('private-image-data', 20), OSError('private-image-data')]
        for failure in failures:
            with self.subTest(failure=type(failure).__name__):
                with mock.patch.object(vision.subprocess, 'run', side_effect=failure):
                    with self.assertRaises(vision.OcrError) as caught:
                        vision.OcrClient().read(image)
                self.assertNotIn('private-image-data', str(caught.exception))

    def test_malformed_ocr_payload_and_out_of_bounds_words_are_rejected(self):
        image = vision.Bitmap(2, 2, bytes(16))
        invalid = ['not-json', '{}', json.dumps({'width': 2, 'height': 2, 'lines': [
            {'text': '3/30', 'words': [{'text': '3/30', 'x': 1, 'y': 1, 'width': 9, 'height': 1}]}]})]
        for stdout in invalid:
            with mock.patch.object(vision.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, stdout, '')):
                with self.assertRaises(vision.OcrError):
                    vision.OcrClient().read(image)

    def test_image_is_sent_only_in_stdin_and_extra_result_fields_are_dropped(self):
        image = vision.Bitmap(2, 2, bytes(16))
        observed = {}
        def process(args, **kwargs):
            observed.update(args=args, **kwargs)
            return subprocess.CompletedProcess(args, 0, json.dumps({'width': 2, 'height': 2,
                'lines': [{'text': '0/30', 'words': [{'text': '0/30', 'x': 0, 'y': 0, 'width': 2, 'height': 2}]}],
                'private': 'discard'}), '')
        with mock.patch.object(vision.subprocess, 'run', side_effect=process):
            result = vision.OcrClient().read(image, scale=2)
        request = json.loads(observed['input'])
        self.assertEqual(base64.b64decode(request['image']), image.to_bmp())
        self.assertEqual(request['scale'], 2)
        self.assertNotIn(request['image'], ' '.join(observed['args']))
        self.assertEqual(observed['timeout'], 20)
        self.assertNotIn('private', result)

    def test_invalid_scale_and_timeout_are_rejected_before_process_launch(self):
        image = vision.Bitmap(1, 1, bytes(4))
        for scale in (True, 0, 4, 2.5):
            with self.subTest(scale=scale), self.assertRaises(ValueError):
                vision.OcrClient().read(image, scale=scale)
        for timeout in (True, 0, -1, 21):
            with self.subTest(timeout=timeout), self.assertRaises(ValueError):
                vision.OcrClient(timeout=timeout)

    @unittest.skipUnless(os.name == 'nt' and shutil.which('powershell.exe') and os.environ.get('REWARDS_SKIP_NATIVE_OCR')!='1', 'Installed desktop Windows OCR required; excluded on CI server images')
    def test_installed_windows_ocr_reads_synthetic_article_pill_without_image_files(self):
        script = r'''
Add-Type -AssemblyName System.Drawing
$bitmap = New-Object System.Drawing.Bitmap(400,90)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.Clear([System.Drawing.Color]::White)
$font = New-Object System.Drawing.Font('Arial',28)
$graphics.DrawString('12/30', $font, [System.Drawing.Brushes]::Black, 10,10)
$memory = New-Object System.IO.MemoryStream
$bitmap.Save($memory,[System.Drawing.Imaging.ImageFormat]::Bmp)
[Console]::Write([Convert]::ToBase64String($memory.ToArray()))
$font.Dispose();$graphics.Dispose();$bitmap.Dispose();$memory.Dispose()
'''
        encoded = base64.b64encode(script.encode('utf-16-le')).decode('ascii')
        created = subprocess.run([str(Path(os.environ['SystemRoot']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'),
            '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], capture_output=True, text=True, timeout=20)
        self.assertEqual(created.returncode, 0)
        image = vision.Bitmap.from_bmp(base64.b64decode(created.stdout))
        result = vision.OcrClient().read(image)
        self.assertEqual(vision.parse_article_ratio(' '.join(line['text'] for line in result['lines'])), 12)


if __name__ == '__main__':
    unittest.main()
