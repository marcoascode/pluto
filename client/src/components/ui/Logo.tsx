import { SvgIcon, type SvgIconProps } from '@mui/material';
import { useId } from 'react';

/** Marca própria do Pluto (foguete). */
export function Logo({ size = 34, ...p }: SvgIconProps & { size?: number }) {
  const id = useId();
  return (
    <SvgIcon viewBox="0 0 34 34" sx={{ width: size, height: size, filter: 'drop-shadow(0 4px 10px rgba(47,111,224,.45))' }} {...p}>
      <defs><linearGradient id={id} x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#1f5fd6" /><stop offset="1" stopColor="#3fb6ff" /></linearGradient></defs>
      <rect width="34" height="34" rx="9" fill={`url(#${id})`} />
      <g transform="translate(5 5) rotate(35 12 12)">
        <path d="M10.2 18.3h3.6L12 22.4z" fill="#ffb547" />
        <path d="M7.6 12.6 4.8 15v3.6l3.4-1.7zM16.4 12.6l2.8 2.4v3.6l-3.4-1.7z" fill="#bfe0ff" />
        <path d="M12 1.8c3.1 2.1 4.7 5.4 4.7 9.4v4.9l-1.9 2.2H9.2l-1.9-2.2v-4.9c0-4 1.6-7.3 4.7-9.4z" fill="#fff" />
        <circle cx="12" cy="9.6" r="1.9" fill="#1f5fd6" />
      </g>
    </SvgIcon>
  );
}
