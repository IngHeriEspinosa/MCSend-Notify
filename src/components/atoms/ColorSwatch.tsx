/**
 * Muestra de color dinámico sin estilos en línea: el color va como atributo `fill` de un SVG.
 * Decorativo: el valor hexadecimal siempre se muestra también como texto (WCAG 1.4.1).
 */
interface ColorSwatchProps {
  color: string;
  /** Texto opcional pintado sobre el color (p. ej. vista previa de un botón). */
  text?: string;
  textColor?: string;
  width?: number;
  height?: number;
}

export function ColorSwatch({ color, text, textColor, width = 40, height = 40 }: ColorSwatchProps) {
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      className="shrink-0 rounded-md border border-line"
    >
      <rect width={width} height={height} rx={6} fill={color} />
      {text ? (
        <text
          x="50%"
          y="50%"
          dominantBaseline="central"
          textAnchor="middle"
          fill={textColor}
          fontSize={14}
          fontWeight={700}
          fontFamily="Arial, sans-serif"
        >
          {text}
        </text>
      ) : null}
    </svg>
  );
}
