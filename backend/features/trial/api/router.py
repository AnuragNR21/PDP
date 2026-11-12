from fastapi import APIRouter, Depends

from app.dependencies import get_database_url
from features.trial.domain.models import TrialEventCommand, TrialFeedbackCommand, TrialHomePayload
from features.trial.service.trial_services import TrialHomeService, TrialOpsService

router = APIRouter(prefix='/trial', tags=['trial'])


@router.get('/home', response_model=TrialHomePayload)
def get_trial_home():
    return TrialHomeService().get_home()


@router.post('/events', status_code=201)
def create_trial_event(command: TrialEventCommand, db_url=Depends(get_database_url)):
    return TrialOpsService(db_url).record_event(command)


@router.post('/feedback', status_code=201)
def create_trial_feedback(command: TrialFeedbackCommand, db_url=Depends(get_database_url)):
    return TrialOpsService(db_url).record_feedback(command)


@router.get('/summary')
def get_trial_summary(db_url=Depends(get_database_url)):
    return TrialOpsService(db_url).get_summary()


@router.post('/reset')
def reset_trial(db_url=Depends(get_database_url)):
    return TrialOpsService(db_url).reset()


@router.post('/reseed')
def reseed_trial(db_url=Depends(get_database_url)):
    return TrialOpsService(db_url).reseed()
