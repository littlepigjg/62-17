import json
import os
from typing import List, Optional, Dict, Any
from dataclasses import dataclass, field
from pathlib import Path

from .crdt import CRDTOperation, CRDTDocument
from ..config import settings


@dataclass
class HistorySnapshot:
    version: int
    timestamp: str
    user_id: str
    user_name: str
    content: str
    operations: List[Dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "version": self.version,
            "timestamp": self.timestamp,
            "user_id": self.user_id,
            "user_name": self.user_name,
            "content": self.content,
            "operations": self.operations,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "HistorySnapshot":
        return cls(
            version=data["version"],
            timestamp=data["timestamp"],
            user_id=data["user_id"],
            user_name=data["user_name"],
            content=data["content"],
            operations=data.get("operations", []),
        )


@dataclass
class DiffChange:
    type: str
    index: int
    char: str
    user_id: str
    user_name: str
    timestamp: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "type": self.type,
            "index": self.index,
            "char": self.char,
            "user_id": self.user_id,
            "user_name": self.user_name,
            "timestamp": self.timestamp,
        }


class HistoryManager:
    def __init__(self):
        self._snapshots: Dict[str, List[HistorySnapshot]] = {}
        self._operations: Dict[str, List[CRDTOperation]] = {}
        self._op_counter: Dict[str, int] = {}
        self._load_history()

    def _get_history_dir(self) -> Path:
        return Path(settings.data_dir) / "history"

    def _get_snapshot_file(self, doc_id: str) -> Path:
        return self._get_history_dir() / f"{doc_id}_snapshots.json"

    def _get_ops_file(self, doc_id: str) -> Path:
        return self._get_history_dir() / f"{doc_id}_operations.json"

    def _load_history(self) -> None:
        history_dir = self._get_history_dir()
        if not history_dir.exists():
            return

        snapshot_files = list(history_dir.glob("*_snapshots.json"))
        for sf in snapshot_files:
            doc_id = sf.stem.replace("_snapshots", "")
            try:
                with open(sf, "r", encoding="utf-8") as f:
                    data = json.load(f)
                self._snapshots[doc_id] = [
                    HistorySnapshot.from_dict(s) for s in data
                ]
            except Exception:
                self._snapshots[doc_id] = []

            ops_file = self._get_ops_file(doc_id)
            if ops_file.exists():
                try:
                    with open(ops_file, "r", encoding="utf-8") as f:
                        ops_data = json.load(f)
                    self._operations[doc_id] = [
                        CRDTOperation.from_dict(o) for o in ops_data
                    ]
                    self._op_counter[doc_id] = len(self._operations[doc_id])
                except Exception:
                    self._operations[doc_id] = []
                    self._op_counter[doc_id] = 0

    def _save_snapshots(self, doc_id: str) -> None:
        history_dir = self._get_history_dir()
        history_dir.mkdir(parents=True, exist_ok=True)
        snapshot_file = self._get_snapshot_file(doc_id)
        data = [s.to_dict() for s in self._snapshots.get(doc_id, [])]
        with open(snapshot_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def _save_operations(self, doc_id: str) -> None:
        history_dir = self._get_history_dir()
        history_dir.mkdir(parents=True, exist_ok=True)
        ops_file = self._get_ops_file(doc_id)
        data = [o.to_dict() for o in self._operations.get(doc_id, [])]
        with open(ops_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def record_operation(self, doc_id: str, op: CRDTOperation) -> None:
        from datetime import datetime
        if doc_id not in self._operations:
            self._operations[doc_id] = []
            self._op_counter[doc_id] = 0

        self._operations[doc_id].append(op)
        self._op_counter[doc_id] += 1

        if self._op_counter[doc_id] % 50 == 0:
            pass

    def create_snapshot(
        self,
        doc_id: str,
        content: str,
        user_id: str,
        user_name: str,
        operations: Optional[List[Dict]] = None,
    ) -> HistorySnapshot:
        from datetime import datetime
        if doc_id not in self._snapshots:
            self._snapshots[doc_id] = []

        version = len(self._snapshots[doc_id])
        snapshot = HistorySnapshot(
            version=version,
            timestamp=datetime.now().isoformat(),
            user_id=user_id,
            user_name=user_name,
            content=content,
            operations=operations or [],
        )
        self._snapshots[doc_id].append(snapshot)
        self._save_snapshots(doc_id)
        return snapshot

    def get_snapshots(self, doc_id: str) -> List[HistorySnapshot]:
        return self._snapshots.get(doc_id, [])

    def get_operations(self, doc_id: str) -> List[CRDTOperation]:
        return self._operations.get(doc_id, [])

    def get_operations_since(self, doc_id: str, timestamp: str) -> List[CRDTOperation]:
        ops = self._operations.get(doc_id, [])
        return [op for op in ops if op.timestamp > timestamp]

    def get_version_at_time(self, doc_id: str, target_time: str) -> Optional[str]:
        snapshots = self._snapshots.get(doc_id, [])
        if not snapshots:
            return None

        target_snapshot = None
        for s in snapshots:
            if s.timestamp <= target_time:
                target_snapshot = s
            else:
                break

        if target_snapshot is None:
            return None

        return target_snapshot.content

    def get_diff_between_versions(
        self, doc_id: str, from_version: int, to_version: int
    ) -> List[DiffChange]:
        snapshots = self._snapshots.get(doc_id, [])
        if from_version < 0 or to_version >= len(snapshots):
            return []

        from_content = snapshots[from_version].content
        to_content = snapshots[to_version].content

        changes = []
        i = j = 0
        while i < len(from_content) and j < len(to_content):
            if from_content[i] == to_content[j]:
                i += 1
                j += 1
            else:
                if j + 1 < len(to_content) and to_content[j + 1] == from_content[i]:
                    changes.append(
                        DiffChange(
                            type="insert",
                            index=j,
                            char=to_content[j],
                            user_id="",
                            user_name="",
                            timestamp="",
                        )
                    )
                    j += 1
                elif i + 1 < len(from_content) and from_content[i + 1] == to_content[j]:
                    changes.append(
                        DiffChange(
                            type="delete",
                            index=i,
                            char=from_content[i],
                            user_id="",
                            user_name="",
                            timestamp="",
                        )
                    )
                    i += 1
                else:
                    changes.append(
                        DiffChange(
                            type="replace",
                            index=j,
                            char=to_content[j],
                            user_id="",
                            user_name="",
                            timestamp="",
                        )
                    )
                    i += 1
                    j += 1

        while j < len(to_content):
            changes.append(
                DiffChange(
                    type="insert",
                    index=j,
                    char=to_content[j],
                    user_id="",
                    user_name="",
                    timestamp="",
                )
            )
            j += 1

        while i < len(from_content):
            changes.append(
                DiffChange(
                    type="delete",
                    index=i,
                    char=from_content[i],
                    user_id="",
                    user_name="",
                    timestamp="",
                )
            )
            i += 1

        return changes

    def get_user_edit_stats(self, doc_id: str) -> Dict[str, Dict[str, Any]]:
        ops = self._operations.get(doc_id, [])
        stats: Dict[str, Dict[str, Any]] = {}
        for op in ops:
            if op.user_id not in stats:
                stats[op.user_id] = {
                    "user_id": op.user_id,
                    "user_name": op.user_name,
                    "inserts": 0,
                    "deletes": 0,
                    "total_chars": 0,
                }
            if op.type == "insert":
                stats[op.user_id]["inserts"] += 1
                stats[op.user_id]["total_chars"] += 1
            elif op.type == "delete":
                stats[op.user_id]["deletes"] += 1
                stats[op.user_id]["total_chars"] += 1
        return stats

    def revert_to_version(self, doc_id: str, version: int, current_doc: CRDTDocument) -> Optional[str]:
        snapshots = self._snapshots.get(doc_id, [])
        if version < 0 or version >= len(snapshots):
            return None

        content = snapshots[version].content
        return content

    def get_latest_version(self, doc_id: str) -> int:
        return len(self._snapshots.get(doc_id, [])) - 1

    def clear_history(self, doc_id: str) -> None:
        if doc_id in self._snapshots:
            del self._snapshots[doc_id]
        if doc_id in self._operations:
            del self._operations[doc_id]
        if doc_id in self._op_counter:
            del self._op_counter[doc_id]

        snapshot_file = self._get_snapshot_file(doc_id)
        ops_file = self._get_ops_file(doc_id)
        if snapshot_file.exists():
            snapshot_file.unlink()
        if ops_file.exists():
            ops_file.unlink()


history_manager = HistoryManager()
