import * as React from 'react'
import { useDropzone } from 'react-dropzone'
import { motion } from 'framer-motion'
import { Upload } from 'lucide-react'

import { cn } from '@/lib/utils'

type Props = {
  accept: Record<string, string[]>
  multiple?: boolean
  disabled?: boolean
  title: string
  description: string
  onFiles: (files: File[]) => void
}

export function DropzoneCard({
  accept,
  multiple,
  disabled,
  title,
  description,
  onFiles,
}: Props) {
  const onDrop = React.useCallback(
    (accepted: File[]) => {
      if (!accepted.length) return
      onFiles(accepted)
    },
    [onFiles]
  )

  const { getRootProps, getInputProps, isDragActive, isDragReject } =
    useDropzone({
      accept,
      multiple,
      disabled,
      onDrop,
    })

  return (
    <div
      {...getRootProps()}
      className={cn(
        'rounded-2xl outline-none',
        disabled && 'pointer-events-none opacity-60'
      )}
    >
      <input {...getInputProps()} />
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className={cn(
          'group relative cursor-pointer overflow-hidden rounded-2xl border-2 border-dashed p-8 text-center transition-all duration-300',
          'border-white/[0.08] bg-gradient-to-b from-card/50 to-transparent',
          'hover:border-[rgba(255,95,109,.35)] hover:bg-card/40 hover:shadow-[0_20px_50px_-25px_rgba(255,95,109,.2)]',
          isDragActive &&
            'scale-[1.01] border-[rgba(255,95,109,.5)] bg-[rgba(255,95,109,.06)] shadow-[0_24px_60px_-20px_rgba(255,95,109,.3)]',
          isDragReject && 'border-destructive/50 bg-destructive/5'
        )}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(600px_240px_at_50%_0%,rgba(255,95,109,.12),transparent_70%)] opacity-0 transition-opacity group-hover:opacity-100" />

        <div className="relative mx-auto flex max-w-sm flex-col items-center gap-4">
          <div
            className={cn(
              'flex h-16 w-16 items-center justify-center rounded-2xl bg-warm-gradient shadow-lg shadow-[rgba(255,95,109,.25)] transition-transform duration-300 group-hover:scale-105',
              isDragActive && 'scale-110'
            )}
          >
            <Upload className="h-7 w-7 text-black" strokeWidth={2.5} />
          </div>

          <div>
            <p className="text-lg font-semibold tracking-tight">
              {isDragActive ? 'Solte aqui!' : title}
            </p>
            <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
          </div>

          <span className="rounded-full bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground ring-1 ring-border">
            PDF · JPG · PNG · WebP · SVG
          </span>
        </div>
      </motion.div>
    </div>
  )
}
