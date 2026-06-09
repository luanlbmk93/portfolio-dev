import * as React from 'react'

export type AsyncTaskState = {
  isRunning: boolean
  progress?: number
  label?: string
}

export function useAsyncTask() {
  const [state, setState] = React.useState<AsyncTaskState>({
    isRunning: false,
  })

  const run = React.useCallback(
    async <T,>(
      fn: (helpers: {
        setProgress: (value?: number) => void
        setLabel: (label?: string) => void
        yieldToUi: () => Promise<void>
      }) => Promise<T>
    ) => {
      setState({ isRunning: true, progress: 0 })
      try {
        const result = await fn({
          setProgress: (progress) =>
            setState((s) => ({ ...s, isRunning: true, progress })),
          setLabel: (label) =>
            setState((s) => ({ ...s, isRunning: true, label })),
          yieldToUi: async () =>
            await new Promise<void>((r) => setTimeout(r, 0)),
        })
        return result
      } finally {
        setState({ isRunning: false })
      }
    },
    []
  )

  return { state, run }
}

