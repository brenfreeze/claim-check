// Stroke icons from the mockups (24×24 viewBox, round caps), drawn with react-native-svg.
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { color } from './tokens';

interface IconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
}

function icon(render: (p: Required<IconProps>) => React.ReactNode, defaultStroke = 1.75) {
  return function Icon({ size = 18, color: c = color.ink, strokeWidth = defaultStroke }: IconProps) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        {render({ size, color: c, strokeWidth })}
      </Svg>
    );
  };
}

export const ChipIcon = icon(() => (
  <>
    <Rect x={7} y={7} width={10} height={10} rx={1.5} />
    <Path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4" />
  </>
));

export const SlidersIcon = icon(() => (
  <>
    <Path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" />
    <Circle cx={16} cy={6} r={2} />
    <Circle cx={10} cy={12} r={2} />
    <Circle cx={18} cy={18} r={2} />
  </>
));

export const CameraIcon = icon(() => (
  <>
    <Path d="M4 8h3l2-3h6l2 3h3v11H4z" />
    <Circle cx={12} cy={13} r={3.5} />
  </>
));

export const ClipboardIcon = icon(() => (
  <>
    <Rect x={6} y={4} width={12} height={17} rx={2} />
    <Path d="M9 4h6v3H9z" />
  </>
));

export const ShareIcon = icon(() => <Path d="M12 3v12M8 7l4-4 4 4M5 13v7h14v-7" />);
export const ChevronRight = icon(() => <Path d="M9 5l7 7-7 7" />);
export const ChevronLeft = icon(() => <Path d="M15 5l-7 7 7 7" />);
export const CheckIcon = icon(() => <Path d="M5 12.5l4.5 4.5L19 7.5" />, 2.5);
export const XIcon = icon(() => <Path d="M6 6l12 12M18 6L6 18" />, 2.5);
export const QuestionIcon = icon(
  () => (
    <>
      <Circle cx={12} cy={12} r={9} />
      <Path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.6v.6" />
    </>
  ),
  2.25,
);
export const ExternalIcon = icon(() => <Path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" />, 2);
export const WifiOffIcon = icon(() => (
  <Path d="M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5-2.7M14 10.3A10 10 0 0 1 19 13M2 8.8a15 15 0 0 1 4.2-2.5M10.7 5a15 15 0 0 1 11.3 3.8M12 20h.01" />
));
export const ShieldIcon = icon(() => <Path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />);
export const SearchIcon = icon(() => (
  <>
    <Circle cx={11} cy={11} r={6.5} />
    <Path d="M20 20l-4.2-4.2" />
  </>
));
