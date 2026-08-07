interface Props {
  name: string;
  className?: string;
  style?: React.CSSProperties;
}

export function Icon({ name, className = '', style }: Props) {
  return <span className={`ico ico-${name} ${className}`.trim()} style={style} />;
}
