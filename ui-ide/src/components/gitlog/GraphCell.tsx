import { GraphRow } from './graph-layout';

const W = 14, H = 26;
const cx = (lane: number) => 7 + lane * W;

export function GraphCell({ row, maxLanes }: { row: GraphRow; maxLanes: number }) {
  const width = Math.max(1, maxLanes) * W;
  const colorAt = (lanes: (string | null)[], i: number) => row.colorOf(lanes[i]) || '#6c707e';
  const lines: React.ReactNode[] = [];
  for (let i = 0; i < Math.max(row.before.length, row.after.length); i++) {
    if (i === row.lane) continue;
    const b = row.before[i], a = row.after[i];
    if (b && a && b === a) lines.push(<line key={`t${i}`} x1={cx(i)} y1={0} x2={cx(i)} y2={H} stroke={colorAt(row.after, i)} strokeWidth={2} />);
    else if (b && !row.merging.includes(i)) lines.push(<line key={`u${i}`} x1={cx(i)} y1={0} x2={cx(i)} y2={H / 2} stroke={colorAt(row.before, i)} strokeWidth={2} />);
    else if (a && !row.parentLanes.some((p) => p.lane === i)) lines.push(<line key={`d${i}`} x1={cx(i)} y1={H / 2} x2={cx(i)} y2={H} stroke={colorAt(row.after, i)} strokeWidth={2} />);
  }
  return (
    <svg className="log-graph" width={width} height={H} viewBox={`0 0 ${width} ${H}`}>
      {lines}
      {row.before[row.lane] && <line x1={cx(row.lane)} y1={0} x2={cx(row.lane)} y2={H / 2} stroke={row.color} strokeWidth={2} />}
      {row.merging.map((m) => <path key={`m${m}`} d={`M${cx(m)} 0 C ${cx(m)} ${H / 2}, ${cx(row.lane)} 0, ${cx(row.lane)} ${H / 2}`} fill="none" stroke={colorAt(row.before, m)} strokeWidth={2} />)}
      {row.hasFirstParent && <line x1={cx(row.lane)} y1={H / 2} x2={cx(row.lane)} y2={H} stroke={row.color} strokeWidth={2} />}
      {row.parentLanes.map((p) => <path key={`p${p.lane}`} d={`M${cx(row.lane)} ${H / 2} C ${cx(row.lane)} ${H}, ${cx(p.lane)} ${H / 2}, ${cx(p.lane)} ${H}`} fill="none" stroke={p.color} strokeWidth={2} />)}
      <circle cx={cx(row.lane)} cy={H / 2} r={4} fill={row.color} stroke="#1e1f22" strokeWidth={1.5} />
    </svg>
  );
}
