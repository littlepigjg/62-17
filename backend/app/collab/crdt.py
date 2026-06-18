import json
import uuid
from typing import List, Optional, Dict, Any, Tuple
from dataclasses import dataclass, field, asdict


@dataclass
class Position:
    path: List[int]
    site: str
    counter: int

    def to_dict(self) -> Dict[str, Any]:
        return {
            "path": self.path,
            "site": self.site,
            "counter": self.counter,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Position":
        return cls(
            path=data["path"],
            site=data["site"],
            counter=data["counter"],
        )

    def compare(self, other: "Position") -> int:
        min_len = min(len(self.path), len(other.path))
        for i in range(min_len):
            if self.path[i] < other.path[i]:
                return -1
            elif self.path[i] > other.path[i]:
                return 1
        if len(self.path) < len(other.path):
            return -1
        elif len(self.path) > len(other.path):
            return 1
        if self.site < other.site:
            return -1
        elif self.site > other.site:
            return 1
        if self.counter < other.counter:
            return -1
        elif self.counter > other.counter:
            return 1
        return 0

    def __lt__(self, other):
        return self.compare(other) < 0

    def __eq__(self, other):
        return self.compare(other) == 0

    def __le__(self, other):
        return self.compare(other) <= 0


@dataclass
class CRDTChar:
    position: Position
    char: str
    visible: bool = True

    def to_dict(self) -> Dict[str, Any]:
        return {
            "position": self.position.to_dict(),
            "char": self.char,
            "visible": self.visible,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "CRDTChar":
        return cls(
            position=Position.from_dict(data["position"]),
            char=data["char"],
            visible=data.get("visible", True),
        )


@dataclass
class CRDTOperation:
    type: str
    char: CRDTChar
    site: str
    timestamp: str
    user_id: str
    user_name: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "type": self.type,
            "char": self.char.to_dict(),
            "site": self.site,
            "timestamp": self.timestamp,
            "user_id": self.user_id,
            "user_name": self.user_name,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "CRDTOperation":
        return cls(
            type=data["type"],
            char=CRDTChar.from_dict(data["char"]),
            site=data["site"],
            timestamp=data["timestamp"],
            user_id=data["user_id"],
            user_name=data["user_name"],
        )


class CRDTDocument:
    def __init__(self, doc_id: str):
        self.doc_id = doc_id
        self.chars: List[CRDTChar] = []
        self._counter: int = 0
        self._site_id: str = str(uuid.uuid4())[:8]

    @property
    def site_id(self) -> str:
        return self._site_id

    def _generate_position_between(
        self, prev: Optional[Position], next_: Optional[Position], site: str
    ) -> Position:
        self._counter += 1
        BASE = 256

        if prev is None and next_ is None:
            return Position(path=[BASE // 2], site=site, counter=self._counter)

        if prev is None:
            path = []
            i = 0
            while True:
                if i < len(next_.path):
                    if next_.path[i] > 0:
                        path.append(next_.path[i] - 1)
                        break
                    else:
                        path.append(0)
                else:
                    path.append(BASE - 1)
                    break
                i += 1
            return Position(path=path, site=site, counter=self._counter)

        if next_ is None:
            path = []
            i = 0
            while True:
                if i < len(prev.path):
                    path.append(prev.path[i])
                    if i == len(prev.path) - 1:
                        path.append(BASE // 2)
                        break
                else:
                    path.append(BASE // 2)
                    break
                i += 1
            return Position(path=path, site=site, counter=self._counter)

        if prev >= next_:
            raise ValueError("prev must be less than next_")

        path = []
        i = 0
        while True:
            prev_val = prev.path[i] if i < len(prev.path) else 0
            next_val = next_.path[i] if i < len(next_.path) else BASE

            if next_val - prev_val > 1:
                mid = (prev_val + next_val) // 2
                path.append(mid)
                break
            else:
                path.append(prev_val)
            i += 1

            if i >= max(len(prev.path), len(next_.path)) and next_val - prev_val <= 1:
                path.append(BASE // 2)
                break

        return Position(path=path, site=site, counter=self._counter)

    def _find_index(self, pos: Position) -> int:
        left, right = 0, len(self.chars)
        while left < right:
            mid = (left + right) // 2
            if self.chars[mid].position < pos:
                left = mid + 1
            else:
                right = mid
        return left

    def _find_visible_index(self, pos: Position) -> int:
        count = 0
        for c in self.chars:
            if c.position == pos:
                return count
            if c.visible:
                count += 1
        return -1

    def _visible_to_crdt_index(self, visible_index: int) -> int:
        visible_count = 0
        for i, c in enumerate(self.chars):
            if c.visible:
                if visible_count == visible_index:
                    return i
                visible_count += 1
        return len(self.chars)

    def insert(self, index: int, char: str, site: str, user_id: str, user_name: str) -> CRDTOperation:
        from datetime import datetime

        prev_pos = None
        next_pos = None

        if len(self.chars) > 0:
            crdt_index = self._visible_to_crdt_index(index)
            if crdt_index > 0:
                prev_pos = self.chars[crdt_index - 1].position
            if crdt_index < len(self.chars):
                next_pos = self.chars[crdt_index].position

        position = self._generate_position_between(prev_pos, next_pos, site)
        crdt_char = CRDTChar(position=position, char=char, visible=True)

        insert_idx = self._find_index(position)
        self.chars.insert(insert_idx, crdt_char)

        return CRDTOperation(
            type="insert",
            char=crdt_char,
            site=site,
            timestamp=datetime.now().isoformat(),
            user_id=user_id,
            user_name=user_name,
        )

    def delete(self, index: int, site: str, user_id: str, user_name: str) -> Optional[CRDTOperation]:
        from datetime import datetime

        visible_count = 0
        for i, c in enumerate(self.chars):
            if c.visible:
                if visible_count == index:
                    self.chars[i].visible = False
                    return CRDTOperation(
                        type="delete",
                        char=c,
                        site=site,
                        timestamp=datetime.now().isoformat(),
                        user_id=user_id,
                        user_name=user_name,
                    )
                visible_count += 1
        return None

    def apply_operation(self, op: CRDTOperation) -> Tuple[bool, int, str]:
        if op.type == "insert":
            idx = self._find_index(op.char.position)
            if idx < len(self.chars) and self.chars[idx].position == op.char.position:
                return False, -1, ""
            self.chars.insert(idx, CRDTChar(
                position=op.char.position,
                char=op.char.char,
                visible=op.char.visible,
            ))
            visible_idx = self._find_visible_index(op.char.position)
            return True, visible_idx, op.char.char
        elif op.type == "delete":
            idx = self._find_index(op.char.position)
            if idx < len(self.chars) and self.chars[idx].position == op.char.position:
                if self.chars[idx].visible:
                    self.chars[idx].visible = False
                    visible_idx = self._find_visible_index(op.char.position)
                    return True, visible_idx, ""
            return False, -1, ""
        return False, -1, ""

    def get_text(self) -> str:
        return "".join(c.char for c in self.chars if c.visible)

    def get_visible_length(self) -> int:
        return sum(1 for c in self.chars if c.visible)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "doc_id": self.doc_id,
            "chars": [c.to_dict() for c in self.chars],
            "counter": self._counter,
            "site_id": self._site_id,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "CRDTDocument":
        doc = cls(data["doc_id"])
        doc.chars = [CRDTChar.from_dict(c) for c in data.get("chars", [])]
        doc._counter = data.get("counter", 0)
        doc._site_id = data.get("site_id", str(uuid.uuid4())[:8])
        return doc

    def load_from_text(self, text: str, site: str, user_id: str, user_name: str) -> None:
        self.chars = []
        self._counter = 0
        for i, char in enumerate(text):
            self.insert(i, char, site, user_id, user_name)
