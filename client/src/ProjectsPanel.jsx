import { useRef, useState } from "react";
import { useStore } from "./lib/store.js";

export default function ProjectsPanel() {
  const [open, setOpen] = useState(false);
  const projects = useStore((s) => s.projects);
  const currentProjectId = useStore((s) => s.currentProjectId);
  const renameProject = useStore((s) => s.renameProject);
  const saveProjectAs = useStore((s) => s.saveProjectAs);
  const loadProject = useStore((s) => s.loadProject);
  const deleteProject = useStore((s) => s.deleteProject);
  const newProject = useStore((s) => s.newProject);
  const exportProject = useStore((s) => s.exportProject);
  const importProjectData = useStore((s) => s.importProjectData);
  const fileInputRef = useRef(null);

  const list = Object.values(projects).sort((a, b) => b.savedAt - a.savedAt);
  const currentName = projects[currentProjectId]?.name || "제목 없음 (자동 저장됨)";

  function handleRename() {
    const name = window.prompt("프로젝트 이름", projects[currentProjectId]?.name || "");
    if (!name) return;
    if (currentProjectId) renameProject(currentProjectId, name);
    else saveProjectAs(name);
  }

  function handleSaveAs() {
    const name = window.prompt("새 프로젝트 이름", "");
    if (name) saveProjectAs(name);
  }

  function handleExport() {
    const { filename, json } = exportProject();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function handleImportFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        importProjectData(JSON.parse(reader.result));
      } catch {
        window.alert("올바른 프로젝트 파일이 아닙니다.");
      }
    };
    reader.readAsText(file);
  }

  return (
    <>
      {open ? (
        <div className="projects-panel">
          <h3>Projects</h3>
          <div className="hint">현재: {currentName}</div>

          <div className="row">
            <button className="btn secondary" onClick={handleRename}>
              이름 변경
            </button>
            <button className="btn secondary" onClick={handleSaveAs}>
              다른 이름으로 저장
            </button>
          </div>
          <div className="row">
            <button className="btn secondary" onClick={() => { if (window.confirm("새 프로젝트를 시작할까요? 현재 작업은 자동 저장되어 있습니다.")) newProject(); }}>
              새 프로젝트
            </button>
            <button className="btn secondary" onClick={handleExport}>
              파일로 내보내기
            </button>
          </div>
          <button className="btn secondary node-footer-btn" onClick={() => fileInputRef.current?.click()}>
            파일에서 가져오기
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            style={{ display: "none" }}
            onChange={(e) => {
              handleImportFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />

          {list.length ? (
            <div className="projects-list">
              {list.map((p) => (
                <div key={p.id} className={`projects-list-item${p.id === currentProjectId ? " active" : ""}`}>
                  <button
                    className="projects-list-name"
                    onClick={() => loadProject(p.id)}
                    title={new Date(p.savedAt).toLocaleString()}
                  >
                    {p.name}
                  </button>
                  <button
                    className="projects-list-delete"
                    title="삭제"
                    onClick={() => {
                      if (window.confirm(`"${p.name}" 삭제할까요?`)) deleteProject(p.id);
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="hint">저장된 프로젝트가 없습니다.</div>
          )}
        </div>
      ) : null}
      <button className="projects-fab" onClick={() => setOpen((v) => !v)}>
        💾 {currentName}
      </button>
    </>
  );
}
