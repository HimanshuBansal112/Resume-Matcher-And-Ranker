from datetime import datetime
from enum import Enum

from sqlalchemy import TEXT, DateTime, Integer, String, func
from sqlalchemy import Enum as SQLAlchemyEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class ResumeStatus(str, Enum):
    IN_QUEUE = "in_queue"
    PROCESSED = "processed"
    REJECTED = "rejected"
    ACCEPTED = "accepted"


class ResumeIndex(Base):
    __tablename__ = "resume_index"

    filename: Mapped[str] = mapped_column(String(250), primary_key=True)

    status: Mapped[ResumeStatus] = mapped_column(SQLAlchemyEnum(ResumeStatus))

    upload_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    file_type: Mapped[str] = mapped_column(String(20))


class JobDescriptions(Base):
    __tablename__ = "job_descriptions"
    sno: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(200))
    raw_text: Mapped[str] = mapped_column(TEXT)
    parsed: Mapped[dict] = mapped_column(JSONB)
    weights: Mapped[dict] = mapped_column(JSONB, default=dict)
    create_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
