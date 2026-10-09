// Design tokens from the mockup handoff (claim-check-mockups/HANDOFF.md).
import type { TextStyle } from 'react-native';
import type { Verdict } from '../core/checkTypes';

export const color = {
  bg: '#F6F4EE',
  surface: '#FFFFFF',
  surfaceMuted: '#EFECE4',
  surfaceSubtle: '#F3F1EB',
  surfaceFaded: '#FBFAF7',
  ink: '#16161A',
  inkBody: '#2C2B28',
  inkSecondary: '#4F4D48',
  inkMuted: '#5E5C57',
  inkFaint: '#6B6862',
  inkDisabled: '#8A867C',
  onInk: '#F6F4EE',
  onInkMuted: '#D6D2C7',
  border: '#E2DED3',
  borderStrong: '#CFCABD',
  borderPanel: '#DDD8CC',
  divider: '#EEEBE3',
  link: '#1B4F93',
  linkBg: '#DFE9F6',
  photoFrame: '#1F1F23',
  placeholder: '#E9E6DF',
  avatar: '#D9D4C8',
  verdict: {
    supported: { fg: '#1B4F93', bg: '#DFE9F6', bar: '#1B4F93' },
    contradicted: { fg: '#9A3A0A', bg: '#F8E3D6', bar: '#B4430C' },
    unverified: { fg: '#4F4D48', bg: '#E9E6DF', bar: '#8A867C' },
  } satisfies Record<Verdict, { fg: string; bg: string; bar: string }>,
} as const;

export const font = {
  display: 'SourceSerif4_600SemiBold',
  displayMedium: 'SourceSerif4_500Medium',
  body: 'IBMPlexSans_400Regular',
  bodyMedium: 'IBMPlexSans_500Medium',
  bodySemibold: 'IBMPlexSans_600SemiBold',
  bodyItalic: 'IBMPlexSans_400Regular_Italic',
  mono: 'IBMPlexMono_400Regular',
  monoMedium: 'IBMPlexMono_500Medium',
} as const;

export const radius = { chip: 999, tag: 6, button: 12, input: 14, card: 16 } as const;
export const space = { screenX: 20, section: 18, cardPad: 14 } as const;
export const minTouch = 44;

/** Type scale (custom fonts carry their weight in the family name, so no fontWeight here). */
export const type = {
  h1: { fontFamily: font.display, fontSize: 31, lineHeight: 35, letterSpacing: -0.45, color: color.ink },
  h1Small: { fontFamily: font.display, fontSize: 26, lineHeight: 31, color: color.ink },
  title: { fontFamily: font.display, fontSize: 20, lineHeight: 26, color: color.ink },
  claimCard: { fontFamily: font.displayMedium, fontSize: 17.5, lineHeight: 23, color: color.ink },
  claimDetail: { fontFamily: font.display, fontSize: 25, lineHeight: 30.5, color: color.ink },
  body: { fontFamily: font.body, fontSize: 15, lineHeight: 22.5, color: color.ink },
  bodySmall: { fontFamily: font.body, fontSize: 14, lineHeight: 20, color: color.ink },
  meta: { fontFamily: font.mono, fontSize: 11.5, lineHeight: 16, color: color.inkMuted },
  sectionLabel: {
    fontFamily: font.bodySemibold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.72,
    textTransform: 'uppercase',
    color: color.inkMuted,
  },
} satisfies Record<string, TextStyle>;
