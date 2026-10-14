import { useShortlist } from "../state/ShortlistProvider";

export function ShortlistFeedback() {
  const shortlist = useShortlist();
  if (!shortlist.error) return null;
  return (
    <div className="metadata-error shortlist-feedback" role="alert">
      <p>{shortlist.error}</p>
      <button className="text-button" onClick={shortlist.retry}>
        Refresh shortlist
      </button>
    </div>
  );
}
