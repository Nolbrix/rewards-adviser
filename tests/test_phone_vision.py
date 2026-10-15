import struct
import unittest

try:
    from companion import phone_vision as vision
except ImportError:
    vision = None


def picture(rows):
    """Literal black/white fixture; dots are white pixels."""
    width = len(rows[0])
    data = b''.join(b'\x00\x00\x00\xff' if item == '#' else b'\xff\xff\xff\xff'
                    for row in rows for item in row)
    return vision.Bitmap(width, len(rows), data)


def dark_picture(rows):
    """White custom-font strokes on the dark gray Bing profile background."""
    width = len(rows[0])
    data = b''.join(b'\xf0\xf0\xf0\xff' if item == '#' else b'\x20\x20\x20\xff'
                    for row in rows for item in row)
    return vision.Bitmap(width, len(rows), data)


def dark_profile(columns):
    rows = [['.'] * 40 for _ in range(10)]
    for x, y in columns:
        rows[y][x] = '#'
    return dark_picture([''.join(row) for row in rows])


class BitmapTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(vision, 'Visual recognition is not implemented')

    def test_top_down_32_bit_bmp_roundtrip_keeps_pixel_order(self):
        pixels = bytes((0, 0, 255, 255, 255, 0, 0, 255,
                        0, 255, 0, 255, 255, 255, 255, 255))
        image = vision.Bitmap(2, 2, pixels)
        encoded = image.to_bmp()
        self.assertEqual(encoded[:2], b'BM')
        self.assertEqual(struct.unpack_from('<i', encoded, 22)[0], -2)
        restored = vision.Bitmap.from_bmp(encoded)
        self.assertEqual((restored.width, restored.height, restored.bgra), (2, 2, pixels))

    def test_bottom_up_24_bit_bmp_ignores_row_padding(self):
        header = struct.pack('<2sIHHI', b'BM', 62, 0, 0, 54)
        dib = struct.pack('<IiiHHIIiiII', 40, 1, 2, 1, 24, 0, 8, 0, 0, 0, 0)
        image = vision.Bitmap.from_bmp(header + dib + b'\xff\x00\x00\x99\x00\x00\xff\x88')
        self.assertEqual(image.bgra, b'\x00\x00\xff\xff\xff\x00\x00\xff')

    def test_malformed_bmp_and_invalid_dimensions_are_rejected(self):
        valid = picture(['#.']).to_bmp()
        cases = [b'', valid[:-1], b'XX' + valid[2:]]
        for offset, value in ((10, 14), (18, -1), (22, 1000000), (30, 3)):
            changed = bytearray(valid)
            struct.pack_into('<i', changed, offset, value)
            cases.append(bytes(changed))
        for malformed in cases:
            with self.subTest(length=len(malformed)), self.assertRaises(ValueError):
                vision.Bitmap.from_bmp(malformed)
        for args in ((True, 1, bytes(4)), (0, 1, b''), (1, 1, bytes(3)), (1000000, 1, b'')):
            with self.subTest(args=args[:2]), self.assertRaises(ValueError):
                vision.Bitmap(*args)

    def test_crop_uses_xy_width_height_and_rejects_partial_regions(self):
        image = picture(['#...', '.##.', '...#'])
        crop = image.crop((1, 1, 2, 2))
        self.assertEqual((crop.width, crop.height), (2, 2))
        self.assertEqual(crop.bgra, picture(['##', '..']).bgra)
        for region in ((-1, 0, 1, 1), (0, 0, 0, 1), (3, 2, 2, 1), (0.5, 0, 1, 1)):
            with self.subTest(region=region), self.assertRaises(ValueError):
                image.crop(region)

    def test_nearest_resize_duplicates_and_downsamples_pixels(self):
        image = picture(['#.', '.#'])
        self.assertEqual(image.resized(4, 4).bgra, picture(['##..', '##..', '..##', '..##']).bgra)
        self.assertEqual(image.resized(1, 1).bgra, b'\x00\x00\x00\xff')


class TemplateTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(vision, 'Visual recognition is not implemented')

    def test_match_jitter_finds_exact_ink_not_white_background(self):
        frame = picture(['.........', '.........', '...##....', '...#.....', '....#....', '.........'])
        template = picture(['##', '#.', '.#'])
        matched = vision.match_at(frame, template, 2, 1, jitter=2)
        self.assertEqual(matched, {'rect': (3, 2, 2, 3), 'score': 1.0})
        self.assertEqual(vision.match_at(frame, picture(['..', '..']), 1, 1)['score'], 0.0)

    def test_find_template_limits_search_to_rectangle(self):
        frame = picture(['.........', '.........', '...##....', '...#.....', '....#....', '.........'])
        template = picture(['##', '#.', '.#'])
        self.assertIsNone(vision.find_template(frame, template, (0, 0, 3, 6)))
        self.assertEqual(vision.find_template(frame, template, (0, 0, 9, 6)),
                         {'rect': (3, 2, 2, 3), 'score': 1.0})

    def test_jaccard_penalizes_extra_foreground_and_rejects_unknown(self):
        frame = picture(['##', '##', '.#'])
        template = picture(['##', '#.', '.#'])
        self.assertAlmostEqual(vision.match_at(frame, template, 0, 0, jitter=0)['score'], 0.8)
        self.assertIsNone(vision.find_template(frame, template, (0, 0, 2, 3), minimum=.9))

    def test_unique_profile_requires_margin_over_similar_identity(self):
        actual = picture(['..#...', '.###..', '##.##.', '######'])
        lookalike = picture(['..#...', '..##..', '##.##.', '######'])
        references = [{'slot': 1, 'email': 'first@example.com', 'bitmap': actual, 'rect': (0, 0, 6, 4)},
                      {'slot': 2, 'email': 'second@example.com', 'bitmap': lookalike, 'rect': (0, 0, 6, 4)}]
        self.assertIsNone(vision.unique_profile(actual, references))

    def test_unique_profile_returns_bound_identity_and_ignores_same_identity_duplicate(self):
        actual = picture(['##..', '.#..', '..##'])
        other = picture(['..##', '..#.', '##..'])
        references = [{'slot': 1, 'email': 'first@example.com', 'bitmap': actual, 'rect': (0, 0, 4, 3)},
                      {'slot': 1, 'email': 'first@example.com', 'bitmap': actual, 'rect': (0, 0, 4, 3)},
                      {'slot': 2, 'email': 'second@example.com', 'bitmap': other, 'rect': (0, 0, 4, 3)}]
        matched = vision.unique_profile(actual, references)
        self.assertEqual(matched, {'slot': 1, 'email': 'first@example.com', 'rect': (0, 0, 4, 3), 'score': 1.0})
        self.assertIsNone(vision.unique_profile(picture(['....', '....', '....']), references))

    def test_dark_profile_matches_its_white_strokes_instead_of_shared_background(self):
        actual = dark_profile([(x, y) for x in range(5, 12) for y in (3, 4)] + [(6, 5), (10, 5)])
        other = dark_profile([(x, y) for x in range(20, 27) for y in (5, 6)] + [(21, 7), (25, 7)])
        refs = [{'slot': 1, 'email': 'first@example.com', 'bitmap': actual, 'rect': (0, 0, 40, 10)},
                {'slot': 2, 'email': 'second@example.com', 'bitmap': other, 'rect': (0, 0, 40, 10)}]
        matched = vision.unique_profile(actual, refs)
        self.assertIsNotNone(matched)
        self.assertEqual(matched['slot'], 1)
        self.assertEqual(matched['score'], 1.0)
        self.assertEqual(vision.unique_profile(other, refs)['slot'], 2)

    def test_dark_profile_lookalikes_still_require_a_unique_foreground_margin(self):
        strokes = [(x, y) for x in range(5, 18) for y in (3, 4)]
        actual = dark_profile(strokes)
        lookalike = dark_profile(strokes + [(18, 4)])
        refs = [{'slot': 1, 'email': 'first@example.com', 'bitmap': actual, 'rect': (0, 0, 40, 10)},
                {'slot': 2, 'email': 'second@example.com', 'bitmap': lookalike, 'rect': (0, 0, 40, 10)}]
        self.assertIsNone(vision.unique_profile(actual, refs))

    def test_unknown_dark_background_and_different_white_strokes_do_not_match(self):
        template = dark_profile([(x, 3) for x in range(5, 15)])
        for unknown in (dark_profile([]), dark_profile([(x, 7) for x in range(24, 34)])):
            with self.subTest(pixels=unknown.bgra.count(b'\xf0')):
                self.assertLess(vision.match_at(unknown, template, 0, 0)['score'], .2)
                self.assertIsNone(vision.find_template(unknown, template, (0, 0, 40, 10)))

    def test_uniform_templates_cannot_match_either_background_polarity(self):
        for template in (dark_picture(['....', '....']), picture(['....', '....']), picture(['####', '####'])):
            for frame in (dark_picture(['........', '........', '........']), picture(['........', '........', '........'])):
                with self.subTest(template=template.bgra[:4], frame=frame.bgra[:4]):
                    self.assertEqual(vision.match_at(frame, template, 0, 0)['score'], 0.0)
                    self.assertIsNone(vision.find_template(frame, template, (0, 0, 8, 3)))

    def test_dark_template_search_finds_only_the_complete_white_glyph_region(self):
        template = dark_picture(['.........', '..##.....', '..#......', '...#.....', '.........'])
        rows = [['.'] * 24 for _ in range(12)]
        for x, y in ((2, 1), (3, 1), (2, 2), (3, 3)):
            rows[y + 5][x + 10] = '#'
        frame = dark_picture([''.join(row) for row in rows])
        self.assertIsNone(vision.find_template(frame, template, (0, 0, 9, 12)))
        self.assertEqual(vision.find_template(frame, template, (0, 0, 24, 12)),
                         {'rect': (10, 5, 9, 5), 'score': 1.0})


class ArticleRatioTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(vision, 'Article ratio parser is not implemented')

    def test_exact_progress_accepts_zero_partial_and_completion(self):
        for text, expected in (('0/30', 0), ('12 / 30', 12), (' 30/30\n', 30), ('3\n/\n30', 3)):
            with self.subTest(text=text):
                self.assertEqual(vision.parse_article_ratio(text), expected)

    def test_absent_ambiguous_or_fuzzy_progress_never_becomes_zero(self):
        for text in (None, True, 0, '', '30', 'O/30', '12/3O', '31/30', '-1/30', '+3/30',
                     '3/60', '03/30', '3.0/30', '0/30 0/30', 'Articoli 0/30', '١/30'):
            with self.subTest(text=text):
                self.assertIsNone(vision.parse_article_ratio(text))

    def test_article_ocr_preparation_keeps_only_bright_source_glyph_pixels_with_white_padding(self):
        source = vision.Bitmap(3, 2, bytes((240, 130, 90, 255, 230, 230, 230, 255, 179, 179, 179, 255,
                                             180, 180, 180, 255, 32, 32, 32, 255, 255, 255, 255, 255)))
        prepared = vision.prepare_article_counter(source)
        self.assertEqual((prepared.width, prepared.height), (23, 22))
        self.assertEqual(prepared.crop((10, 10, 3, 2)).bgra, picture(['.#.', '#.#']).bgra)
        self.assertEqual(sum(row.bit_count() for row in prepared.ink_rows()), 3)
        self.assertEqual(prepared.crop((0, 0, 23, 10)).bgra, b'\xff' * (23 * 10 * 4))

    def test_article_ocr_preparation_never_draws_digits_into_an_empty_pill(self):
        blank = vision.Bitmap(65, 36, bytes((240, 130, 90, 255)) * (65 * 36))
        prepared = vision.prepare_article_counter(blank)
        self.assertTrue(all(row == 0 for row in prepared.ink_rows()))
        self.assertEqual((prepared.width, prepared.height), (85, 56))

    def test_article_ocr_preparation_rejects_non_counter_sized_images(self):
        for source in (None, picture(['.' * 161]), vision.Bitmap(1, 81, b'\xff' * (81 * 4))):
            with self.subTest(source=type(source).__name__), self.assertRaises(ValueError):
                vision.prepare_article_counter(source)


if __name__ == '__main__':
    unittest.main()
