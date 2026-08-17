export interface LogCommit {
  hash: string;
  short: string;
  parents: string[];
  author: string;
  email: string;
  at: number;
  date: string;
  subject: string;
  refs: string[];
  head: boolean;
}

export interface GraphRow {
  lane: number;
  color: string;
  before: (string | null)[];
  after: (string | null)[];
  merging: number[];
  parentLanes: { lane: number; color: string }[];
  hasFirstParent: boolean;
  colorOf: (hash: string | null) => string | undefined;
}

export const LANE_COLORS = ['#3574f0', '#57965c', '#c77dbb', '#e5a53b', '#2aacb8', '#f75464', '#8fd79a', '#d5b778', '#a371f7', '#56a8f5'];

export function layoutGraph(commits: LogCommit[]): GraphRow[] {
  const lanes: (string | null)[] = [];
  const colorOf = new Map<string, string>();
  let colorSeq = 0;
  const nextColor = () => LANE_COLORS[colorSeq++ % LANE_COLORS.length];
  const lookup = (h: string | null) => (h ? colorOf.get(h) : undefined);
  return commits.map((c) => {
    let lane = lanes.indexOf(c.hash);
    if (lane < 0) lane = lanes.indexOf(null) < 0 ? lanes.length : lanes.indexOf(null);
    if (!colorOf.has(c.hash)) colorOf.set(c.hash, nextColor());
    const color = colorOf.get(c.hash)!;
    const before = lanes.slice();
    const merging: number[] = [];
    for (let i = 0; i < lanes.length; i++) if (i !== lane && lanes[i] === c.hash) {
      merging.push(i);
      lanes[i] = null;
    }
    lanes[lane] = c.parents[0] || null;
    if (c.parents[0] && !colorOf.has(c.parents[0])) colorOf.set(c.parents[0], color);
    const parentLanes = c.parents.slice(1).map((p) => {
      let l = lanes.indexOf(p);
      if (l < 0) {
        l = lanes.indexOf(null, lane + 1);
        if (l < 0) l = lanes.length;
        lanes[l] = p;
      }
      if (!colorOf.has(p)) colorOf.set(p, nextColor());
      return { lane: l, color: colorOf.get(p)! };
    });
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
    return { lane, color, before, after: lanes.slice(), merging, parentLanes, hasFirstParent: !!c.parents[0], colorOf: lookup };
  });
}
