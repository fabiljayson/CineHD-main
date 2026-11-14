import unittest

from drmproxy.utils.shell_safety import quote_for_shell


class QuoteForShellTest(unittest.TestCase):
    def test_plain_values_are_unchanged(self):
        self.assertEqual(quote_for_shell("https://example.test/a.m3u8"), "https://example.test/a.m3u8")
        self.assertEqual(quote_for_shell("--key 1234:abcd"), "--key 1234:abcd")

    def test_double_quote_cannot_close_the_command(self):
        payload = 'https://example.test/a.m3u8" ; rm -rf /tmp/x ; "'
        escaped = quote_for_shell(payload)
        self.assertNotIn('a.m3u8" ;', escaped)
        self.assertIn('a.m3u8\\" ;', escaped)
        self.assertEqual(escaped.count("\\\""), 2)

    def test_shell_expansions_are_neutralised(self):
        escaped = quote_for_shell("$(id)`whoami`$HOME")
        # Les caracteres subsistent mais sont precedes d'un antislash : entre
        # guillemets doubles, `\$` et ``\` `` sont litteraux pour le shell.
        self.assertEqual(escaped, "\\$(id)\\`whoami\\`\\$HOME")
        unescaped = escaped.replace("\\$", "").replace("\\`", "")
        self.assertNotIn("$", unescaped)
        self.assertNotIn("`", unescaped)

    def test_backslash_is_escaped_first(self):
        self.assertEqual(quote_for_shell('a\\"b'), 'a\\\\\\"b')

    def test_control_characters_are_rejected(self):
        for value in ["a\nb", "a\rb", "a\x00b", "a\x1fb"]:
            with self.assertRaises(ValueError):
                quote_for_shell(value)

    def test_none_becomes_empty_string(self):
        self.assertEqual(quote_for_shell(None), "")


if __name__ == "__main__":
    unittest.main()
