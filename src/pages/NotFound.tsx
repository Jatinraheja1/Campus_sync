import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="center-screen">
      <div className="card panel denied">
        <h2>Page not found</h2>
        <p>That address does not exist in CampusSync.</p>
        <Link className="btn btn-primary" to="/">Back to start</Link>
      </div>
    </div>
  );
}
