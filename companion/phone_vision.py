"""Local bitmap recognition and bounded Windows OCR, without UI operations.

Pixels are top-down, tightly packed BGRA. Rectangles use (x, y, width,
height); search bounds use (left, top, right, bottom), excluding right/bottom.
Matching compares foreground ink with Jaccard similarity, never background.
"""

import base64
import json
import math
import os
from pathlib import Path
import re
import struct
import subprocess


def _integer(value, minimum=0, maximum=8192):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError('invalid-integer')
    return value


class Bitmap:
    __slots__ = ('width', 'height', 'bgra', '_masks')

    def __init__(self, width, height, bgra):
        self.width = _integer(width, 1)
        self.height = _integer(height, 1)
        if width * height > 16000000 or not isinstance(bgra, (bytes, bytearray, memoryview)):
            raise ValueError('invalid-bitmap')
        if len(bgra) != width * height * 4:
            raise ValueError('invalid-bitmap-size')
        self.bgra = bytes(bgra)
        self._masks = {}

    @classmethod
    def from_bmp(cls, data):
        if not isinstance(data, (bytes, bytearray, memoryview)) or len(data) < 54:
            raise ValueError('invalid-bmp')
        signature, size, _, _, offset = struct.unpack_from('<2sIHHI', data)
        dib, width, signed_height, planes, bits, compression = struct.unpack_from('<IiiHHI', data, 14)
        if signature != b'BM' or dib < 40 or offset < 14 + dib or offset > len(data):
            raise ValueError('invalid-bmp-header')
        height = abs(signed_height)
        _integer(width, 1)
        _integer(height, 1)
        if width * height > 16000000 or planes != 1 or bits not in (24, 32) or compression != 0:
            raise ValueError('unsupported-bmp')
        stride = ((width * bits + 31) // 32) * 4
        end = offset + stride * height
        if size < end or size > len(data) or end > len(data):
            raise ValueError('truncated-bmp')
        output = bytearray(width * height * 4)
        for y in range(height):
            source_y = y if signed_height < 0 else height - 1 - y
            row_start = offset + source_y * stride
            destination = y * width * 4
            if bits == 32:
                output[destination:destination + width * 4] = data[row_start:row_start + width * 4]
            else:
                for x in range(width):
                    source = row_start + x * 3
                    target = destination + x * 4
                    output[target:target + 3] = data[source:source + 3]
                    output[target + 3] = 255
        return cls(width, height, output)

    def to_bmp(self):
        size = len(self.bgra)
        return (struct.pack('<2sIHHI', b'BM', 54 + size, 0, 0, 54) +
                struct.pack('<IiiHHIIiiII', 40, self.width, -self.height, 1, 32, 0, size, 0, 0, 0, 0) + self.bgra)

    def crop(self, rect):
        x, y, width, height = _rectangle(rect)
        if x + width > self.width or y + height > self.height:
            raise ValueError('crop-out-of-bounds')
        rows = [self.bgra[((y + row) * self.width + x) * 4:
                          ((y + row) * self.width + x + width) * 4] for row in range(height)]
        return Bitmap(width, height, b''.join(rows))

    def resized(self, width, height):
        _integer(width, 1)
        _integer(height, 1)
        if width * height > 16000000:
            raise ValueError('invalid-bitmap-size')
        columns = [x * self.width // width * 4 for x in range(width)]
        output = bytearray()
        for y in range(height):
            row = y * self.height // height * self.width * 4
            for column in columns:
                output.extend(self.bgra[row + column:row + column + 4])
        return Bitmap(width, height, output)

    def ink_rows(self, threshold=130, light=False):
        """Each integer uses bit x for pixel x, with a fixed foreground polarity.

        The default retains dark-ink semantics. Template matching may request
        light ink for a predominantly dark reference; the frame must then use
        that same polarity rather than deciding independently from its pixels.
        """
        _integer(threshold, 1, 255)
        if not isinstance(light, bool):
            raise ValueError('invalid-ink-polarity')
        key = (threshold, light)
        if key not in self._masks:
            if light:
                mask = (1 << self.width) - 1
                self._masks[key] = tuple(mask ^ row for row in self.ink_rows(threshold))
                return self._masks[key]
            rows = []
            for y in range(self.height):
                mask = 0
                start = y * self.width * 4
                for x in range(self.width):
                    at = start + x * 4
                    blue, green, red = self.bgra[at:at + 3]
                    if red * 299 + green * 587 + blue * 114 < threshold * 1000:
                        mask |= 1 << x
                rows.append(mask)
            self._masks[key] = tuple(rows)
        return self._masks[key]


def _rectangle(rect):
    if not isinstance(rect, (list, tuple)) or len(rect) != 4:
        raise ValueError('invalid-rectangle')
    x, y, width, height = rect
    _integer(x)
    _integer(y)
    _integer(width, 1)
    _integer(height, 1)
    return x, y, width, height


def _similarity(frame_rows, template_rows, foreground, mask, x, y):
    intersection = observed = 0
    for index, expected in enumerate(template_rows):
        actual = (frame_rows[y + index] >> x) & mask
        intersection += (actual & expected).bit_count()
        observed += actual.bit_count()
    union = foreground + observed - intersection
    return intersection / union if foreground and union else 0.0


def _score_limit(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 < value <= 1:
        raise ValueError('invalid-score-limit')
    return value


def _template_ink(template, threshold):
    """Infer only a dominant dark background, keeping tight black-glyph crops.

    Profile references include padding around white letters on dark Bing
    screens. Without polarity selection the common dark background overwhelms
    the identity score. Uniform templates have no foreground in either theme.
    """
    rows = template.ink_rows(threshold)
    dark = sum(row.bit_count() for row in rows)
    light = dark * 10 >= template.width * template.height * 7
    if light:
        rows = template.ink_rows(threshold, light=True)
    return rows, sum(row.bit_count() for row in rows), light


def match_at(frame, template, x, y, jitter=2, threshold=130):
    """Return best in-bounds position within jitter, or None if none exists."""
    _integer(x)
    _integer(y)
    _integer(jitter, 0, 8)
    template_rows, foreground, light = _template_ink(template, threshold)
    frame_rows = frame.ink_rows(threshold, light=light)
    mask = (1 << template.width) - 1
    best = None
    for top in range(max(0, y - jitter), min(frame.height - template.height, y + jitter) + 1):
        for left in range(max(0, x - jitter), min(frame.width - template.width, x + jitter) + 1):
            score = _similarity(frame_rows, template_rows, foreground, mask, left, top)
            if best is None or score > best['score']:
                best = {'rect': (left, top, template.width, template.height), 'score': score}
    return best


def find_template(frame, template, search, minimum=.90, threshold=130):
    """Find a complete template inside exclusive search bounds; blank ink fails."""
    _score_limit(minimum)
    if not isinstance(search, (tuple, list)) or len(search) != 4:
        raise ValueError('invalid-search')
    left, top, right, bottom = [_integer(value) for value in search]
    if right > frame.width or bottom > frame.height or left > right or top > bottom:
        raise ValueError('invalid-search')
    template_rows, foreground, light = _template_ink(template, threshold)
    if not foreground:
        return None
    frame_rows = frame.ink_rows(threshold, light=light)
    mask = (1 << template.width) - 1
    best = None
    for y in range(top, bottom - template.height + 1):
        for x in range(left, right - template.width + 1):
            score = _similarity(frame_rows, template_rows, foreground, mask, x, y)
            if score >= minimum and (best is None or score > best['score']):
                best = {'rect': (x, y, template.width, template.height), 'score': score}
    return best


def unique_profile(frame, refs, minScore=.90, minMargin=.12):
    """Return the bound slot/email only when its score beats every other identity.

    Multiple calibrated samples of the same (slot, email) count as one identity.
    A reference's bitmap dimensions must equal its rectangle dimensions.
    """
    _score_limit(minScore)
    if isinstance(minMargin, bool) or not isinstance(minMargin, (int, float)) or not math.isfinite(minMargin) or not 0 <= minMargin <= 1:
        raise ValueError('invalid-score-margin')
    identities = {}
    for ref in refs:
        slot, email, bitmap = ref['slot'], ref['email'], ref['bitmap']
        _integer(slot, 1, 3)
        if not isinstance(email, str) or '@' not in email or len(email) > 254:
            raise ValueError('invalid-identity')
        x, y, width, height = _rectangle(ref['rect'])
        if (width, height) != (bitmap.width, bitmap.height):
            raise ValueError('reference-size-mismatch')
        found = match_at(frame, bitmap, x, y)
        if found is None:
            continue
        key = (slot, email.strip().casefold())
        candidate = {'slot': slot, 'email': key[1], **found}
        if key not in identities or candidate['score'] > identities[key]['score']:
            identities[key] = candidate
    ranked = sorted(identities.values(), key=lambda item: item['score'], reverse=True)
    if not ranked or ranked[0]['score'] < minScore:
        return None
    if len(ranked) > 1 and ranked[0]['score'] - ranked[1]['score'] < minMargin:
        return None
    return ranked[0]


def parse_article_ratio(text):
    """Accept only one isolated ASCII earned/30 ratio, with no OCR substitutions."""
    if not isinstance(text, str):
        return None
    matched = re.fullmatch(r'\s*(0|[1-9]|[12][0-9]|30)\s*/\s*30\s*', text)
    return int(matched.group(1)) if matched else None


def prepare_article_counter(bitmap):
    """Prepare the isolated white-on-blue pill for local Windows OCR.

    Preserve the bright source strokes as black pixels on a padded white
    background. This is a fixed contrast transform: it never redraws glyphs,
    substitutes OCR characters or creates progress when the pill is absent.
    """
    if not isinstance(bitmap, Bitmap) or bitmap.width > 160 or bitmap.height > 80:
        raise ValueError('invalid-counter-bitmap')
    padding = 10
    width, height = bitmap.width + padding * 2, bitmap.height + padding * 2
    output = bytearray(b'\xff' * (width * height * 4))
    for y in range(bitmap.height):
        for x in range(bitmap.width):
            source = (y * bitmap.width + x) * 4
            blue, green, red = bitmap.bgra[source:source + 3]
            if red * 299 + green * 587 + blue * 114 >= 180000:
                target = ((y + padding) * width + x + padding) * 4
                output[target:target + 3] = b'\x00\x00\x00'
    return Bitmap(width, height, output)


class OcrError(RuntimeError):
    """Only a bounded machine-readable code, never image or raw OCR error text."""


class OcrClient:
    def __init__(self, timeout=20):
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not math.isfinite(timeout) or not 0 < timeout <= 20:
            raise ValueError('invalid-ocr-timeout')
        self.timeout = timeout
        self.script = Path(__file__).with_name('phone_ocr.ps1')
        self.executable = str(Path(os.environ.get('SystemRoot', r'C:\Windows')) /
                              'System32/WindowsPowerShell/v1.0/powershell.exe')

    def read(self, bitmap, scale=3):
        _integer(scale, 1, 3)
        request = json.dumps({'image': base64.b64encode(bitmap.to_bmp()).decode('ascii'), 'scale': scale})
        args = [self.executable, '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', str(self.script)]
        try:
            result = subprocess.run(args, input=request, capture_output=True, text=True, encoding='utf-8',
                                    timeout=self.timeout, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        except subprocess.TimeoutExpired:
            raise OcrError('ocr-timeout') from None
        except (OSError, UnicodeError):
            raise OcrError('ocr-unavailable') from None
        if result.returncode != 0 or len(result.stdout) > 2000000:
            raise OcrError('ocr-unavailable')
        try:
            return self._validated(json.loads(result.stdout), bitmap)
        except (ValueError, TypeError, KeyError, OverflowError):
            raise OcrError('ocr-invalid-result') from None

    @staticmethod
    def _validated(payload, bitmap):
        if not isinstance(payload, dict) or payload.get('width') != bitmap.width or payload.get('height') != bitmap.height:
            raise ValueError('invalid-dimensions')
        source_lines = payload['lines']
        if not isinstance(source_lines, list) or len(source_lines) > 256:
            raise ValueError('invalid-lines')
        lines = []
        word_count = 0
        for source in source_lines:
            text = source['text']
            source_words = source['words']
            if not isinstance(text, str) or len(text) > 4096 or not isinstance(source_words, list):
                raise ValueError('invalid-line')
            words = []
            word_count += len(source_words)
            if word_count > 4096:
                raise ValueError('too-many-words')
            for source_word in source_words:
                word = {'text': source_word['text']}
                if not isinstance(word['text'], str) or len(word['text']) > 4096:
                    raise ValueError('invalid-word')
                for key in ('x', 'y', 'width', 'height'):
                    value = source_word[key]
                    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or value < 0:
                        raise ValueError('invalid-bounds')
                    word[key] = value
                if word['x'] + word['width'] > bitmap.width or word['y'] + word['height'] > bitmap.height:
                    raise ValueError('invalid-bounds')
                words.append(word)
            lines.append({'text': text, 'words': words})
        return {'width': bitmap.width, 'height': bitmap.height, 'lines': lines}
