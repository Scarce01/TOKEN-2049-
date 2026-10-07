import { Link } from 'react-router'
import { EmptyState } from '../components/ui'

export default function NotFound() {
  return <div className="max-w-[560px] mx-auto mt-24"><EmptyState title="This cell is empty" desc="The page you’re looking for isn’t part of the hive." action={<Link to="/" className="inline-flex items-center h-9 px-4 rounded-md bg-honey text-ink text-[13px] font-semibold">Back to Overview</Link>} /></div>
}
