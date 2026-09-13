/**
 * Tas binaire minimal sur typed arrays.
 *
 * Sur deux millions de cellules, un tableau d'objets coûterait autant que
 * l'algorithme lui-même : les clés et les charges utiles vivent donc dans deux
 * typed arrays parallèles, et rien n'est alloué pendant le parcours.
 * Voir docs/hydrologie.md.
 */

export class MinHeap {
  private keys: Float32Array;
  private values: Int32Array;
  private count = 0;

  constructor(capacity: number) {
    this.keys = new Float32Array(capacity);
    this.values = new Int32Array(capacity);
  }

  get size(): number {
    return this.count;
  }

  clear(): void {
    this.count = 0;
  }

  push(key: number, value: number): void {
    if (this.count === this.keys.length) this.grow();

    let i = this.count;
    this.count += 1;
    this.keys[i] = key;
    this.values[i] = value;

    // Remontée.
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent]! <= this.keys[i]!) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  /** Retire et renvoie la valeur de clé minimale. Le tas doit être non vide. */
  pop(): number {
    const top = this.values[0]!;
    this.count -= 1;

    if (this.count > 0) {
      this.keys[0] = this.keys[this.count]!;
      this.values[0] = this.values[this.count]!;

      // Descente.
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        if (left >= this.count) break;
        const right = left + 1;
        const child = right < this.count && this.keys[right]! < this.keys[left]! ? right : left;
        if (this.keys[i]! <= this.keys[child]!) break;
        this.swap(i, child);
        i = child;
      }
    }

    return top;
  }

  private swap(a: number, b: number): void {
    const key = this.keys[a]!;
    this.keys[a] = this.keys[b]!;
    this.keys[b] = key;
    const value = this.values[a]!;
    this.values[a] = this.values[b]!;
    this.values[b] = value;
  }

  private grow(): void {
    const keys = new Float32Array(this.keys.length * 2);
    keys.set(this.keys);
    this.keys = keys;
    const values = new Int32Array(this.values.length * 2);
    values.set(this.values);
    this.values = values;
  }
}
