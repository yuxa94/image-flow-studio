export default function NodeShell({ title, badge, children, selected }) {
  return (
    <div className={`rf-node${selected ? " selected" : ""}`}>
      <div className="rf-node-header">
        <span>{title}</span>
        {badge ? <span className="badge">{badge}</span> : null}
      </div>
      <div className="rf-node-body">{children}</div>
    </div>
  );
}
