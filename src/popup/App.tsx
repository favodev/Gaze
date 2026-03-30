function App() {
  return (
    <main className="w-[360px] p-4">
      <h1 className="text-lg font-semibold">Gaze</h1>
      <p className="mt-2 text-sm text-slate-600">
        Popup base ready. Here we will show today summary and top distraction
        sites.
      </p>
      <a
        className="mt-4 inline-block rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
        href="../dashboard/index.html"
        target="_blank"
        rel="noreferrer"
      >
        Open dashboard
      </a>
    </main>
  )
}

export default App
