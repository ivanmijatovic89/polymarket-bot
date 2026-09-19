'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { BacktestsTable } from '@/components/BacktestsTable'
import { BacktestsFilters } from '@/components/BacktestsFilters'
import {
  backtestBrowseParams,
  readBacktestBrowseState,
  type BacktestBrowseState,
} from '@/lib/backtestBrowse'

/** URL-backed controls keep filtered pages bookmarkable and support browser history. */
export function BacktestsBrowser() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const query = searchParams.toString()
  const [state, setState] = useState(() => readBacktestBrowseState(new URLSearchParams(query)))

  useEffect(() => {
    setState(readBacktestBrowseState(new URLSearchParams(query)))
  }, [query])

  const update = useCallback(
    (next: BacktestBrowseState, replace = false) => {
      setState(next)
      const params = backtestBrowseParams(next).toString()
      const url = params ? `/backtests?${params}` : '/backtests'
      if (replace) router.replace(url, { scroll: false })
      else router.push(url, { scroll: false })
    },
    [router],
  )

  const changePage = useCallback(
    (page: number, snapshot?: number, replace = false) => {
      update({ ...state, page, snapshot }, replace)
    },
    [state, update],
  )

  return (
    <div className="space-y-4">
      <BacktestsFilters value={state} onChange={update} />
      <BacktestsTable
        {...state}
        status={state.status || undefined}
        onPageChange={changePage}
        stickyHeader
        emptyHint="Try widening or clearing the filters."
      />
    </div>
  )
}
