import logging

from sqlalchemy import select
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from expenses_web.ai.service import LLMAssistantService
from expenses_web.core.app_logging import get_logger, log_event
from expenses_web.core.config import get_settings
from expenses_web.db.models import LLMJob
from expenses_web.db.session import session_scope
from expenses_web.services import RecurringRuleService

logger = get_logger("expenses_web.scheduler")


class SchedulerManager:
    def __init__(self) -> None:
        settings = get_settings()
        self.scheduler = BackgroundScheduler(timezone=settings.timezone)

    def _run_job(self, source: str = "manual") -> None:
        log_event(logger, logging.INFO, "scheduler_run_started", source=source)
        with session_scope() as session:
            service = RecurringRuleService(session)
            count = service.catch_up_all()
            log_event(
                logger,
                logging.INFO,
                "scheduler_run_completed",
                source=source,
                occurrences_posted=count,
            )

    def _run_llm_trace_prune(self) -> None:
        with session_scope() as session:
            user_ids = session.scalars(select(LLMJob.user_id).distinct()).all()
            deleted = 0
            for user_id in user_ids:
                deleted += LLMAssistantService(
                    session, user_id=user_id
                ).prune_trace_rows()
            if deleted:
                log_event(
                    logger,
                    logging.INFO,
                    "llm_trace_prune_completed",
                    deleted_rows=deleted,
                )

    def start(self) -> None:
        self._run_job("startup")

        trigger = CronTrigger(hour=3, minute=15)
        self.scheduler.add_job(
            self._run_job,
            trigger,
            args=["daily_03:15"],
            id="recurring_daily",
            replace_existing=True,
            misfire_grace_time=3600,
        )

        trigger = CronTrigger(hour=4, minute=10)
        self.scheduler.add_job(
            self._run_llm_trace_prune,
            trigger,
            id="llm_trace_prune_daily",
            replace_existing=True,
            misfire_grace_time=3600,
        )

        trigger = IntervalTrigger(hours=1)
        self.scheduler.add_job(
            self._run_job,
            trigger,
            args=["hourly_safety_net"],
            id="recurring_hourly_safety",
            replace_existing=True,
            misfire_grace_time=300,
        )

        self.scheduler.start()
        log_event(
            logger,
            logging.INFO,
            "scheduler_started",
            daily_trigger="03:15",
            llm_trace_prune_trigger="04:10",
            safety_net_hours=1,
        )

    def stop(self) -> None:
        if self.scheduler.running:
            self.scheduler.shutdown(wait=False)
            log_event(logger, logging.INFO, "scheduler_stopped")
