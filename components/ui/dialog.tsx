'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'

export function StudioDialog({ title, description, close, children }: {
  title: string; description: string; close: () => void; children: React.ReactNode
}) {
  return <Dialog.Root open onOpenChange={open => { if (!open) close() }}>
    <Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay" />
      <Dialog.Content className="dialog">
        <Dialog.Title>{title}</Dialog.Title>
        <Dialog.Description>{description}</Dialog.Description>
        <Dialog.Close className="icon-button dialog-close" aria-label="Close dialog"><X size={19} /></Dialog.Close>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}
