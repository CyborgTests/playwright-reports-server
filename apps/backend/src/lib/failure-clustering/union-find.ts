/**
 * Disjoint-set over string nodes (path compression + union-by-rank). 
 * Merges failure-cluster keys; 
 * Cluster identity is derived from the set's keys.
 */
export class UnionFind {
  private parent = new Map<string, string>();
  private rank = new Map<string, number>();

  // register a node.
  add(x: string): void {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.rank.set(x, 0);
    }
  }

  // find the representative of `x`'s set, compressing the path.
  find(x: string): string {
    this.add(x);
    let root = x;
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root) as string;
    }
    // path compression.
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur) as string;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  // merge the sets containing `a` and `b`.
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    const rankA = this.rank.get(ra) as number;
    const rankB = this.rank.get(rb) as number;
    if (rankA < rankB) {
      this.parent.set(ra, rb);
    } else if (rankA > rankB) {
      this.parent.set(rb, ra);
    } else {
      this.parent.set(rb, ra);
      this.rank.set(ra, rankA + 1);
    }
  }

  // all registered nodes, in insertion order.
  nodes(): string[] {
    return [...this.parent.keys()];
  }

  // group all registered nodes by their set representative.
  components(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const node of this.parent.keys()) {
      const root = this.find(node);
      const list = out.get(root);
      if (list) list.push(node);
      else out.set(root, [node]);
    }
    return out;
  }
}
