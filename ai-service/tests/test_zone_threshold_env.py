"""Verifies DEFAULT_ZONE_THRESHOLD_SEC (the fallback used by zone_rules.error_config when
a camera/zone can't be resolved) is configurable via the DEFAULT_ZONE_THRESHOLD_SEC env
var, and safely falls back to 300 when it's unset or invalid — see zone_rules.py.

Reloads the zone_rules module per-case (rather than importing the module-level constant
once) since it's read from the environment at import time.

Run with:  python -m unittest ai-service/tests/test_zone_threshold_env.py -v
       or:  python ai-service/tests/test_zone_threshold_env.py
"""
import importlib
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import zone_rules  # noqa: E402

ENV_VAR = "DEFAULT_ZONE_THRESHOLD_SEC"


class DefaultZoneThresholdEnvTests(unittest.TestCase):
    def setUp(self):
        self._original = os.environ.get(ENV_VAR)

    def tearDown(self):
        if self._original is None:
            os.environ.pop(ENV_VAR, None)
        else:
            os.environ[ENV_VAR] = self._original
        importlib.reload(zone_rules)

    def _reload_with_env(self, value):
        if value is None:
            os.environ.pop(ENV_VAR, None)
        else:
            os.environ[ENV_VAR] = value
        return importlib.reload(zone_rules)

    def test_missing_env_var_falls_back_to_300(self):
        module = self._reload_with_env(None)
        self.assertEqual(module.DEFAULT_ZONE_THRESHOLD_SEC, 300)

    def test_valid_env_var_overrides_default(self):
        module = self._reload_with_env("600")
        self.assertEqual(module.DEFAULT_ZONE_THRESHOLD_SEC, 600)

    def test_non_numeric_env_var_falls_back_to_300(self):
        module = self._reload_with_env("not-a-number")
        self.assertEqual(module.DEFAULT_ZONE_THRESHOLD_SEC, 300)

    def test_zero_or_negative_env_var_falls_back_to_300(self):
        self.assertEqual(self._reload_with_env("0").DEFAULT_ZONE_THRESHOLD_SEC, 300)
        self.assertEqual(self._reload_with_env("-5").DEFAULT_ZONE_THRESHOLD_SEC, 300)

    def test_overridden_default_is_used_by_error_config(self):
        module = self._reload_with_env("120")
        config = module.error_config(None, None, "camera_not_found")
        self.assertEqual(config["applied_threshold_seconds"], 120)


if __name__ == "__main__":
    unittest.main()
