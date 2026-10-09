// Long text cut at a word boundary with an inline "See more" / "See less" toggle. Cut by character count rather than
// measured lines so it behaves the same on iOS, Android and web, and the toggle stays inline at the end of the text.
import { useState } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { color, font } from '../tokens';

export function clip(text: string, max: number): string | null {
  if (text.length <= max) return null;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export function ExpandableText({ text, max, style, prefix = '', suffix = '' }: {
  text: string;
  max: number;
  style?: StyleProp<TextStyle>;
  /** wraps the text, e.g. quotes */
  prefix?: string;
  suffix?: string;
}) {
  const [open, setOpen] = useState(false);
  const short = clip(text, max);
  if (!short) return <Text style={style}>{`${prefix}${text}${suffix}`}</Text>;
  return (
    <Text style={style}>
      {open ? `${prefix}${text}${suffix}` : `${prefix}${short}${suffix}`}{' '}
      <Text
        accessibilityRole="button"
        accessibilityLabel={open ? 'Show less' : 'Show the full text'}
        onPress={() => setOpen((o) => !o)}
        suppressHighlighting
        style={{ fontFamily: font.bodyMedium, fontStyle: 'normal', color: color.link }}
      >
        {open ? 'See less' : 'See more'}
      </Text>
    </Text>
  );
}
