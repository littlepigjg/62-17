export interface PositionData {
  path: number[];
  site: string;
  counter: number;
}

export interface CRDTCharData {
  position: PositionData;
  char: string;
  visible: boolean;
}

export interface CRDTOperationData {
  type: 'insert' | 'delete';
  char: CRDTCharData;
  site: string;
  timestamp: string;
  user_id: string;
  user_name: string;
}

export interface CRDTDocumentData {
  doc_id: string;
  chars: CRDTCharData[];
  counter: number;
  site_id: string;
}

const BASE = 256;

export class Position {
  path: number[];
  site: string;
  counter: number;

  constructor(path: number[], site: string, counter: number) {
    this.path = path;
    this.site = site;
    this.counter = counter;
  }

  static fromDict(data: PositionData): Position {
    return new Position(data.path, data.site, data.counter);
  }

  toDict(): PositionData {
    return { path: this.path, site: this.site, counter: this.counter };
  }

  compare(other: Position): number {
    const minLen = Math.min(this.path.length, other.path.length);
    for (let i = 0; i < minLen; i++) {
      if (this.path[i] < other.path[i]) return -1;
      if (this.path[i] > other.path[i]) return 1;
    }
    if (this.path.length < other.path.length) return -1;
    if (this.path.length > other.path.length) return 1;
    if (this.site < other.site) return -1;
    if (this.site > other.site) return 1;
    if (this.counter < other.counter) return -1;
    if (this.counter > other.counter) return 1;
    return 0;
  }

  equals(other: Position): boolean {
    return this.compare(other) === 0;
  }

  lessThan(other: Position): boolean {
    return this.compare(other) < 0;
  }
}

export class CRDTChar {
  position: Position;
  char: string;
  visible: boolean;

  constructor(position: Position, char: string, visible = true) {
    this.position = position;
    this.char = char;
    this.visible = visible;
  }

  static fromDict(data: CRDTCharData): CRDTChar {
    return new CRDTChar(Position.fromDict(data.position), data.char, data.visible);
  }

  toDict(): CRDTCharData {
    return {
      position: this.position.toDict(),
      char: this.char,
      visible: this.visible,
    };
  }
}

export class CRDTOperation {
  type: 'insert' | 'delete';
  char: CRDTChar;
  site: string;
  timestamp: string;
  user_id: string;
  user_name: string;

  constructor(
    type: 'insert' | 'delete',
    char: CRDTChar,
    site: string,
    timestamp: string,
    user_id: string,
    user_name: string,
  ) {
    this.type = type;
    this.char = char;
    this.site = site;
    this.timestamp = timestamp;
    this.user_id = user_id;
    this.user_name = user_name;
  }

  static fromDict(data: CRDTOperationData): CRDTOperation {
    return new CRDTOperation(
      data.type,
      CRDTChar.fromDict(data.char),
      data.site,
      data.timestamp,
      data.user_id,
      data.user_name,
    );
  }

  toDict(): CRDTOperationData {
    return {
      type: this.type,
      char: this.char.toDict(),
      site: this.site,
      timestamp: this.timestamp,
      user_id: this.user_id,
      user_name: this.user_name,
    };
  }
}

export type ApplyResult = [boolean, number, string];

export class CRDTDocument {
  docId: string;
  chars: CRDTChar[] = [];
  private _counter = 0;
  private _siteId: string;

  constructor(docId: string) {
    this.docId = docId;
    this._siteId = Math.random().toString(36).slice(2, 10);
  }

  get siteId(): string {
    return this._siteId;
  }

  get counter(): number {
    return this._counter;
  }

  setSiteId(site: string): void {
    this._siteId = site;
  }

  setCounter(value: number): void {
    this._counter = value;
  }

  private generatePositionBetween(
    prev: Position | null,
    next: Position | null,
    site: string,
  ): Position {
    this._counter += 1;

    if (prev === null && next === null) {
      return new Position([Math.floor(BASE / 2)], site, this._counter);
    }

    if (prev === null && next !== null) {
      const path: number[] = [];
      let i = 0;
      while (true) {
        if (i < next.path.length) {
          if (next.path[i] > 0) {
            path.push(next.path[i] - 1);
            break;
          } else {
            path.push(0);
          }
        } else {
          path.push(BASE - 1);
          break;
        }
        i += 1;
      }
      return new Position(path, site, this._counter);
    }

    if (next === null && prev !== null) {
      const path: number[] = [];
      let i = 0;
      while (true) {
        if (i < prev.path.length) {
          path.push(prev.path[i]);
          if (i === prev.path.length - 1) {
            path.push(Math.floor(BASE / 2));
            break;
          }
        } else {
          path.push(Math.floor(BASE / 2));
          break;
        }
        i += 1;
      }
      return new Position(path, site, this._counter);
    }

    const prevPos = prev as Position;
    const nextPos = next as Position;
    if (!prevPos.lessThan(nextPos)) {
      throw new Error('prev must be less than next');
    }

    const path: number[] = [];
    let i = 0;
    while (true) {
      const prevVal = i < prevPos.path.length ? prevPos.path[i] : 0;
      const nextVal = i < nextPos.path.length ? nextPos.path[i] : BASE;

      if (nextVal - prevVal > 1) {
        const mid = Math.floor((prevVal + nextVal) / 2);
        path.push(mid);
        break;
      } else {
        path.push(prevVal);
      }
      i += 1;

      if (i >= Math.max(prevPos.path.length, nextPos.path.length) && nextVal - prevVal <= 1) {
        path.push(Math.floor(BASE / 2));
        break;
      }
    }

    return new Position(path, site, this._counter);
  }

  private findIndex(pos: Position): number {
    let left = 0;
    let right = this.chars.length;
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (this.chars[mid].position.lessThan(pos)) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }
    return left;
  }

  private findVisibleIndex(pos: Position): number {
    let count = 0;
    for (const c of this.chars) {
      if (c.position.equals(pos)) return count;
      if (c.visible) count += 1;
    }
    return -1;
  }

  private visibleToCrdtIndex(visibleIndex: number): number {
    let visibleCount = 0;
    for (let i = 0; i < this.chars.length; i++) {
      if (this.chars[i].visible) {
        if (visibleCount === visibleIndex) return i;
        visibleCount += 1;
      }
    }
    return this.chars.length;
  }

  insert(
    index: number,
    char: string,
    site: string,
    userId: string,
    userName: string,
  ): CRDTOperation {
    let prevPos: Position | null = null;
    let nextPos: Position | null = null;

    if (this.chars.length > 0) {
      const crdtIndex = this.visibleToCrdtIndex(index);
      if (crdtIndex > 0) prevPos = this.chars[crdtIndex - 1].position;
      if (crdtIndex < this.chars.length) nextPos = this.chars[crdtIndex].position;
    }

    const position = this.generatePositionBetween(prevPos, nextPos, site);
    const crdtChar = new CRDTChar(position, char, true);
    const insertIdx = this.findIndex(position);
    this.chars.splice(insertIdx, 0, crdtChar);

    return new CRDTOperation(
      'insert',
      crdtChar,
      site,
      new Date().toISOString(),
      userId,
      userName,
    );
  }

  delete(
    index: number,
    site: string,
    userId: string,
    userName: string,
  ): CRDTOperation | null {
    let visibleCount = 0;
    for (let i = 0; i < this.chars.length; i++) {
      if (this.chars[i].visible) {
        if (visibleCount === index) {
          this.chars[i].visible = false;
          return new CRDTOperation(
            'delete',
            this.chars[i],
            site,
            new Date().toISOString(),
            userId,
            userName,
          );
        }
        visibleCount += 1;
      }
    }
    return null;
  }

  applyOperation(op: CRDTOperation): ApplyResult {
    if (op.type === 'insert') {
      const idx = this.findIndex(op.char.position);
      if (idx < this.chars.length && this.chars[idx].position.equals(op.char.position)) {
        return [false, -1, ''];
      }
      this.chars.splice(
        idx,
        0,
        new CRDTChar(op.char.position, op.char.char, op.char.visible),
      );
      const visibleIdx = this.findVisibleIndex(op.char.position);
      return [true, visibleIdx, op.char.char];
    } else if (op.type === 'delete') {
      const idx = this.findIndex(op.char.position);
      if (idx < this.chars.length && this.chars[idx].position.equals(op.char.position)) {
        if (this.chars[idx].visible) {
          this.chars[idx].visible = false;
          const visibleIdx = this.findVisibleIndex(op.char.position);
          return [true, visibleIdx, ''];
        }
      }
      return [false, -1, ''];
    }
    return [false, -1, ''];
  }

  getText(): string {
    let text = '';
    for (const c of this.chars) if (c.visible) text += c.char;
    return text;
  }

  getVisibleLength(): number {
    let count = 0;
    for (const c of this.chars) if (c.visible) count += 1;
    return count;
  }

  toDict(): CRDTDocumentData {
    return {
      doc_id: this.docId,
      chars: this.chars.map(c => c.toDict()),
      counter: this._counter,
      site_id: this._siteId,
    };
  }

  static fromDict(data: CRDTDocumentData): CRDTDocument {
    const doc = new CRDTDocument(data.doc_id);
    doc.chars = data.chars.map(c => CRDTChar.fromDict(c));
    doc._counter = data.counter ?? 0;
    if (data.site_id) doc._siteId = data.site_id;
    return doc;
  }

  loadFromText(text: string, site: string, userId: string, userName: string): void {
    this.chars = [];
    this._counter = 0;
    for (let i = 0; i < text.length; i++) {
      this.insert(i, text[i], site, userId, userName);
    }
  }

  maxCounterForSite(site: string): number {
    let max = 0;
    for (const c of this.chars) {
      if (c.position.site === site && c.position.counter > max) {
        max = c.position.counter;
      }
    }
    return max;
  }
}
