"""M-010 (V4) — colab_exec.py urllib scheme allowlist regression test.

`_http_get` (colab_exec.py:29-36) must refuse any non-http(s) URL BEFORE calling
urllib.request.urlopen, so a misconfigured COLAB_BASE cannot turn the bridge into
a file:// (or other-scheme) read. These tests exercise the real guard — they never
reach the network (the guard raises first).

Run: python3 -m pytest bugfix/test_colab_exec.py
"""
import importlib.util
import pathlib

import pytest

_MOD_PATH = pathlib.Path(__file__).parent / "colab_exec.py"
_spec = importlib.util.spec_from_file_location("colab_exec", _MOD_PATH)
colab_exec = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(colab_exec)


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "file://localhost/etc/passwd",
        "ftp://example.com/x",
        "gopher://example.com/",
        "data:text/plain,hello",
        "//example.com/no-scheme",
    ],
)
def test_http_get_rejects_non_http_scheme(url):
    with pytest.raises(ValueError):
        colab_exec._http_get(url, "tok")


@pytest.mark.parametrize("url", ["http://localhost:9100/api", "https://example.com/api"])
def test_http_get_accepts_http_schemes_past_the_guard(url):
    # http(s) passes the scheme guard; it then attempts a real request which fails
    # (no server) — proving the guard did NOT reject an allowed scheme. Any error
    # OTHER than the guard's ValueError message is acceptable here.
    try:
        colab_exec._http_get(url, "tok")
    except ValueError as e:  # must not be the scheme-guard rejection
        assert "refusing non-http(s) URL" not in str(e)
    except Exception:
        pass  # network/URL error is expected and fine
