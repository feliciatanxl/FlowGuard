import unittest
from unittest.mock import patch, MagicMock
import sys
import os

# Ensure ai-service root is on path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import main


class TestAlertDiagnostics(unittest.TestCase):

    @patch('main.http_requests.post')
    def test_fire_alert_logs_success_only_on_2xx(self, mock_post):
        mock_response = MagicMock()
        mock_response.status_code = 201
        mock_post.return_value = mock_response

        with patch('builtins.print') as mock_print:
            main._fire_alert(
                class_name="person",
                zone_name="Zone A",
                duration_sec=None,
                person_name="John Doe",
                severity="Critical",
                source="SecurePi Edge Node",
                alert_type="Restricted-Zone Motion",
                confidence=0.95
            )
            mock_print.assert_called_with("🚨 Alert sent: person in Zone A (last seen: John Doe)")

    @patch('main.http_requests.post')
    def test_fire_alert_logs_http_rejection_on_non_2xx(self, mock_post):
        mock_response = MagicMock()
        mock_response.status_code = 401
        mock_post.return_value = mock_response

        with patch('builtins.print') as mock_print:
            main._fire_alert(
                class_name="person",
                zone_name="Zone A",
                duration_sec=None,
                person_name=None,
                severity="Critical",
                source="SecurePi Edge Node",
                alert_type="Restricted-Zone Motion",
                confidence=0.95
            )
            mock_print.assert_called_with("[DetectionAlert] POST rejected HTTP 401")

    @patch('main._fire_alert')
    def test_browser_webcam_restricted_motion_is_blocked(self, mock_fire):
        main._maybe_fire_restricted_motion_alert(
            class_name="person",
            zone_name="Zone A",
            source="Browser Webcam",
            conf=0.95,
            person_name="Felicia",
            track_id=1
        )
        mock_fire.assert_not_called()


if __name__ == '__main__':
    unittest.main()
