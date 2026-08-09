import { DirectionalGameView } from './DirectionalGameView'

/**
 * TEMPORARY page — live view of the `directional-game-opus` protocol.
 * Delete with:
 *   rm -rf dashboard/src/app/directional-game dashboard/src/app/api/directional-game
 */
export const dynamic = 'force-dynamic'

export default function DirectionalGamePage() {
  return <DirectionalGameView />
}
