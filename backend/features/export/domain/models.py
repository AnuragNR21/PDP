from pydantic import BaseModel


class ExportPack(BaseModel):
    generated_at: str
    results: list[dict]
    issues: list[dict]
    actions: list[dict]
    evaluation_summary: dict
