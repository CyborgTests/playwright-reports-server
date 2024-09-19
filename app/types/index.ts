import { SVGProps } from 'react';

export type IconSvgProps = SVGProps<SVGSVGElement> & {
  size?: number;
};

export type UUID = `${string}-${string}-${string}-${string}-${string}`;
