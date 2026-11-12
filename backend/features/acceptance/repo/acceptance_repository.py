
from shared.db import get_connection


class AcceptanceRepository:
    def __init__(self, db_url: str):
        self._db_url = db_url

    def count_trial_events(self) -> int:
        with get_connection(self._db_url) as connection:
            row = connection.execute('SELECT COUNT(*) AS item_count FROM trial_event').fetchone()
        return int(row['item_count'])

    def count_trial_feedback(self) -> int:
        with get_connection(self._db_url) as connection:
            row = connection.execute('SELECT COUNT(*) AS item_count FROM trial_feedback').fetchone()
        return int(row['item_count'])

    def count_discovery_sessions(self) -> int:
        with get_connection(self._db_url) as connection:
            row = connection.execute('SELECT COUNT(*) AS item_count FROM discovery_session').fetchone()
        return int(row['item_count'])

    def count_results(self) -> int:
        with get_connection(self._db_url) as connection:
            row = connection.execute('SELECT COUNT(*) AS item_count FROM check_result').fetchone()
        return int(row['item_count'])

    def count_impact_findings(self) -> int:
        with get_connection(self._db_url) as connection:
            row = connection.execute('SELECT COUNT(*) AS item_count FROM impact_finding').fetchone()
        return int(row['item_count'])

    def count_improve_candidates(self) -> int:
        with get_connection(self._db_url) as connection:
            row = connection.execute('SELECT COUNT(*) AS item_count FROM improve_candidate').fetchone()
        return int(row['item_count'])

    def count_work_programs(self) -> int:
        with get_connection(self._db_url) as connection:
            row = connection.execute('SELECT COUNT(*) AS item_count FROM work_program').fetchone()
        return int(row['item_count'])

    def count_verifications(self) -> int:
        with get_connection(self._db_url) as connection:
            row = connection.execute('SELECT COUNT(*) AS item_count FROM verification_evidence').fetchone()
        return int(row['item_count'])

    def count_follow_up_queue_open(self) -> int:
        with get_connection(self._db_url) as connection:
            row = connection.execute(
                "SELECT COUNT(*) AS item_count FROM verification_follow_up_state WHERE queue_status != 'resolved'"
            ).fetchone()
        return int(row['item_count'])
