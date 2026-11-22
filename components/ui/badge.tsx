import type { ComponentProps } from 'react'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function Badge({ className, tone = 'neutral', ...props }: ComponentProps<'span'> & {
  tone?: 'neutral' | 'danger'
}) {
  return <span data-slot="badge" className={twMerge(clsx(
    'inline-flex w-fit shrink-0 items-center whitespace-nowrap rounded-[7px] px-[7px] py-[3px] text-[.78rem] font-semibold',
    tone === 'neutral' && 'bg-[var(--soft)] text-[var(--muted)]',
    tone === 'danger' && 'bg-[var(--danger-bg)] text-[var(--danger)]',
    className,
  ))} {...props} />
}
