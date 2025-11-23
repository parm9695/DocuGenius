
import React, { useState, useRef, useEffect } from 'react';
import { FileUploader } from './components/FileUploader';
import { analyzeDocument } from './services/geminiService';
import { templateStorage, TemplateFile } from './services/templateStorage';
import { AnalysisResult } from './types';
import { CodeBlock } from './components/CodeBlock';
import { 
  FileText, 
  Library, 
  ArrowRight, 
  CheckCircle2, 
  FileType,
  Terminal,
  Code2,
  Database,
  XCircle,
  Key,
  Settings,
  LogOut,
  User as UserIcon,
  LogIn,
  Save,
  Cloud
} from 'lucide-react';

// --- Types for Auth ---
interface User {
  username: string;
  apiKey?: string;
}

export default function App() {
  // --- Auth State ---
  const [user, setUser] = useState<User | null>(null);
  const [usernameInput, setUsernameInput] = useState('');
  
  // --- App State ---
  const [targetFile, setTargetFile] = useState<File | null>(null);
  const [referenceFiles, setReferenceFiles] = useState<File[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'pdf' | 'excel' | 'data'>('pdf');
  
  // --- UI State ---
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  
  const logsEndRef = useRef<HTMLDivElement>(null);

  // --- Load Templates on Mount ---
  useEffect(() => {
    const loadTemplates = async () => {
      setIsLoadingTemplates(true);
      try {
        const savedTemplates = await templateStorage.getAllTemplates();
        if (savedTemplates.length > 0) {
          setReferenceFiles(savedTemplates);
        }
      } catch (e) {
        console.error("Failed to load templates", e);
      } finally {
        setIsLoadingTemplates(false);
      }
    };
    loadTemplates();
  }, []);

  // --- Auth Handlers ---
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!usernameInput.trim()) return;

    const username = usernameInput.trim().toLowerCase();
    
    // Check if this user has a saved key in localStorage
    const storageKey = `docugenius_user_${username}`;
    const savedApiKey = localStorage.getItem(storageKey);

    setUser({
      username: usernameInput.trim(), // Keep original casing for display
      apiKey: savedApiKey || undefined
    });
  };

  const handleLogout = () => {
    setUser(null);
    setResult(null);
    setTargetFile(null);
    // We do NOT clear referenceFiles on logout, as they are shared/global on the device
    setLogs([]);
    setUsernameInput('');
    setError(null);
  };

  const handleSaveKey = (key: string) => {
    if (!user) return;
    
    const cleanKey = key.trim();
    // Update local state
    setUser({ ...user, apiKey: cleanKey });
    // Update persistent storage for this specific user
    const storageKey = `docugenius_user_${user.username.toLowerCase()}`;
    localStorage.setItem(storageKey, cleanKey);
    
    setShowKeyModal(false);
  };

  // --- File Handlers ---
  const handleTargetSelect = (files: File[]) => {
    setTargetFile(files[0]);
    setResult(null);
    setError(null);
    setLogs([]);
  };

  const handleReferenceSelect = async (files: File[]) => {
    if (!user) return;
    
    // Optimistically update UI first (optional, but here we wait for DB to ensure consistency)
    const newFiles: File[] = [];

    for (const file of files) {
      try {
        // Save to IndexedDB
        const savedFile = await templateStorage.saveTemplate(file, user.username);
        newFiles.push(savedFile);
      } catch (e) {
        console.error(`Failed to save template ${file.name}`, e);
        // Fallback: just add the file to state without ID (won't persist next reload)
        newFiles.push(file);
      }
    }

    setReferenceFiles(prev => [...newFiles, ...prev]); // Prepend new files
  };

  const removeReference = async (index: number) => {
    const fileToRemove = referenceFiles[index] as TemplateFile;
    
    // If it has a DB ID, remove it from IndexedDB
    if (fileToRemove._dbId) {
      try {
        await templateStorage.deleteTemplate(fileToRemove._dbId);
      } catch (e) {
        console.error("Failed to delete template from DB", e);
      }
    }

    setReferenceFiles(prev => prev.filter((_, i) => i !== index));
  };

  const addLog = (message: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const runAnalysis = async () => {
    if (!targetFile) return;

    // Check API Key from User Object
    const keyToUse = user?.apiKey || process.env.API_KEY;

    if (!keyToUse) {
      setShowKeyModal(true);
      return;
    }

    setIsAnalyzing(true);
    setError(null);
    setResult(null);
    setLogs([]);
    addLog("Starting analysis session...");

    try {
      const data = await analyzeDocument(keyToUse, targetFile, referenceFiles, addLog);
      setResult(data);
    } catch (err: any) {
      const errorMsg = err.message || "An error occurred during analysis.";
      setError(errorMsg);
      addLog(`ERROR: ${errorMsg}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // --- Login Screen Render ---
  if (!user) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center p-4 relative overflow-hidden">
        {/* Background blobs */}
        <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-indigo-600/20 rounded-full blur-[100px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-blue-600/20 rounded-full blur-[100px]"></div>

        <div className="w-full max-w-md bg-[#1e293b] border border-slate-700 rounded-2xl shadow-2xl p-8 z-10 animate-fade-in">
           <div className="text-center mb-8">
             <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-indigo-500 to-blue-600 rounded-xl mb-4 shadow-lg shadow-indigo-500/30">
               <FileText className="w-8 h-8 text-white" />
             </div>
             <h1 className="text-3xl font-bold text-white tracking-tight mb-2">DocuGenius</h1>
             <p className="text-slate-400">Universal Layout Converter</p>
           </div>

           <form onSubmit={handleLogin} className="space-y-6">
             <div>
               <label htmlFor="username" className="block text-sm font-medium text-slate-300 mb-2">
                 Username / Identifier
               </label>
               <div className="relative">
                 <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                 <input 
                    id="username"
                    type="text" 
                    value={usernameInput}
                    onChange={(e) => setUsernameInput(e.target.value)}
                    placeholder="Enter your name"
                    className="w-full bg-[#0f172a] border border-slate-600 rounded-xl pl-10 pr-4 py-3.5 text-white placeholder:text-slate-600 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                    autoFocus
                 />
               </div>
               <p className="text-xs text-slate-500 mt-2 ml-1">
                 We use this to remember your API key settings.
               </p>
             </div>

             <button 
               type="submit"
               disabled={!usernameInput.trim()}
               className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl py-3.5 font-bold shadow-lg shadow-indigo-500/25 transition-all flex items-center justify-center gap-2"
             >
               <span>Continue</span>
               <ArrowRight className="w-5 h-5" />
             </button>
           </form>
        </div>
      </div>
    );
  }

  // --- Main App Render ---
  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-200 pb-20 font-sans relative">
      {/* Header */}
      <header className="bg-[#1e293b] border-b border-slate-700 sticky top-0 z-10 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-500 p-2 rounded-lg">
              <FileText className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight hidden sm:block">DocuGenius</h1>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {/* User Profile Info */}
            <div className="hidden md:flex flex-col items-end mr-2">
                <span className="text-sm font-medium text-white">{user.username}</span>
                <span className="text-xs text-slate-400">
                    {user.apiKey ? 'API Key Saved' : 'No API Key'}
                </span>
            </div>

            <button 
              onClick={() => setShowKeyModal(true)}
              className={`text-sm font-medium px-3 py-2 rounded-lg border flex items-center gap-2 transition-colors
                ${user.apiKey 
                  ? 'bg-green-500/10 text-green-400 border-green-500/50 hover:bg-green-500/20' 
                  : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/50 hover:bg-indigo-500/20 animate-pulse-border'
                }`}
              title="Manage API Key"
            >
              <Key className="w-4 h-4" />
              <span className="hidden sm:inline">{user.apiKey ? 'Key Configured' : 'Set API Key'}</span>
            </button>

            <div className="h-6 w-px bg-slate-700 mx-1"></div>

            <button 
               onClick={handleLogout}
               className="text-slate-400 hover:text-red-400 transition-colors p-2 rounded-lg hover:bg-slate-800"
               title="Logout"
            >
               <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* API Key Modal */}
      {showKeyModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-[#1e293b] border border-slate-700 rounded-xl p-6 w-full max-w-md shadow-2xl transform transition-all scale-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Settings className="w-5 h-5 text-indigo-400" />
                Configure API Key
              </h3>
              <button onClick={() => setShowKeyModal(false)} className="text-slate-400 hover:text-white">
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            
            <p className="text-slate-400 text-sm mb-4">
              Setting key for user: <strong className="text-white">{user.username}</strong>
            </p>
            <p className="text-slate-500 text-xs mb-4">
              <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline font-medium">
                Get a free API key from Google AI Studio
              </a>
            </p>
            
            <div className="mb-6">
              <div className="relative">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input 
                  type="password" 
                  defaultValue={user.apiKey || ''}
                  onChange={(e) => {
                      // Just local input state, saving happens on button click
                  }}
                  onBlur={(e) => {
                      // Optional: could validate here
                  }}
                  ref={(input) => { if (input && !user.apiKey) input.focus() }} // Auto focus if empty
                  placeholder="AIzaSy..."
                  className="w-full bg-[#0f172a] border border-slate-600 rounded-lg pl-10 pr-4 py-3 text-white text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all placeholder:text-slate-600"
                />
              </div>
            </div>
            
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setShowKeyModal(false)} 
                className="px-4 py-2 text-slate-300 hover:text-white text-sm font-medium"
              >
                Cancel
              </button>
              <button 
                onClick={(e) => {
                    // Find the input value relative to this button to avoid extra state
                    const input = e.currentTarget.parentElement?.previousElementSibling?.querySelector('input') as HTMLInputElement;
                    handleSaveKey(input.value);
                }} 
                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-bold shadow-lg shadow-indigo-500/20 transition-all"
              >
                Save Key
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Input Section */}
        <div className={`grid grid-cols-1 lg:grid-cols-12 gap-8 mb-12 transition-all duration-500 ${result ? 'hidden' : 'block'}`}>
          
          {/* Reference Library */}
          <div className="lg:col-span-4 space-y-4">
            <div className="bg-[#1e293b] p-6 rounded-2xl shadow-xl border border-slate-700 h-full flex flex-col">
              <div className="flex items-center gap-2 mb-4 text-indigo-400">
                <Library className="w-5 h-5" />
                <h2 className="text-lg font-semibold text-white">Reference Library</h2>
              </div>
              <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-3 mb-6">
                 <div className="flex items-start gap-2">
                    <Cloud className="w-4 h-4 text-indigo-400 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-indigo-200">
                      <strong>Shared Library:</strong> Files uploaded here are saved to this device's storage. Anyone logging in on this browser can use them as templates.
                    </p>
                 </div>
              </div>
              
              {isLoadingTemplates ? (
                 <div className="flex-1 flex items-center justify-center text-slate-500 text-sm animate-pulse">
                    Loading library...
                 </div>
              ) : (
                <FileUploader 
                    label="Add to Library" 
                    subLabel="Upload templates to share"
                    files={referenceFiles}
                    onFileSelect={handleReferenceSelect}
                    onRemove={removeReference}
                    multiple={true}
                    icon={<Library className="w-8 h-8 text-indigo-400" />}
                />
              )}
            </div>
          </div>

          {/* Target File & Action */}
          <div className="lg:col-span-8 space-y-6">
            <div className="bg-[#1e293b] p-6 rounded-2xl shadow-xl border border-slate-700">
              <div className="flex items-center gap-2 mb-4 text-indigo-400">
                <FileType className="w-5 h-5" />
                <h2 className="text-lg font-semibold text-white">Target File</h2>
              </div>
              <p className="text-sm text-slate-400 mb-6">
                Upload the document you want to convert to code.
              </p>

              <div className="flex flex-col gap-6">
                <FileUploader 
                  label="Upload Target Document"
                  subLabel="Drag & drop your file here"
                  files={targetFile ? [targetFile] : []}
                  onFileSelect={handleTargetSelect}
                  onRemove={() => setTargetFile(null)}
                  multiple={false}
                  icon={<FileText className="w-8 h-8 text-indigo-400" />}
                />
                
                <button
                  onClick={runAnalysis}
                  disabled={!targetFile || isAnalyzing}
                  className={`
                    w-full flex items-center justify-center gap-2 px-8 py-4 rounded-xl font-bold text-lg shadow-lg transition-all
                    ${!targetFile || isAnalyzing 
                      ? 'bg-slate-700 text-slate-500 cursor-not-allowed' 
                      : 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white hover:from-indigo-500 hover:to-blue-500 hover:shadow-indigo-500/25'}
                  `}
                >
                  {isAnalyzing ? 'Initializing...' : 'Generate Code'} 
                  {!isAnalyzing && <ArrowRight className="w-5 h-5" />}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Terminal / Status Log View */}
        {(isAnalyzing || (logs.length > 0 && !result)) && (
          <div className="max-w-3xl mx-auto mb-12 animate-fade-in">
            <div className="bg-[#0d1117] rounded-xl border border-slate-700 shadow-2xl overflow-hidden font-mono text-sm">
              <div className="bg-[#161b22] px-4 py-2 border-b border-slate-700 flex items-center gap-2">
                <Terminal className="w-4 h-4 text-slate-400" />
                <span className="text-slate-300 font-semibold">Analysis Terminal</span>
                {isAnalyzing && <span className="animate-pulse text-indigo-400 ml-auto text-xs">Processing...</span>}
              </div>
              <div className="p-4 h-64 overflow-y-auto flex flex-col gap-1">
                {logs.map((log, i) => (
                  <div key={i} className={`flex gap-2 ${log.includes("ERROR") ? 'text-red-400' : 'text-slate-300'}`}>
                    <span className="text-slate-600 shrink-0">$</span>
                    <span>{log}</span>
                  </div>
                ))}
                {isAnalyzing && (
                  <div className="flex gap-2 text-indigo-400">
                     <span className="text-slate-600 shrink-0">$</span>
                     <span className="animate-pulse">_</span>
                  </div>
                )}
                <div ref={logsEndRef} />
              </div>
            </div>
            {error && (
               <button 
                 onClick={() => { setError(null); setLogs([]); }}
                 className="mt-4 text-slate-400 hover:text-white text-sm flex items-center gap-2 mx-auto"
               >
                 <XCircle className="w-4 h-4" /> Reset and try again
               </button>
            )}
          </div>
        )}

        {/* Results Section */}
        {result && !isAnalyzing && (
          <div className="space-y-6 animate-fade-in">
            <div className="flex items-center justify-between">
               <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                 <CheckCircle2 className="w-6 h-6 text-green-500" /> Generation Complete
               </h2>
               <button 
                 onClick={() => { setResult(null); setTargetFile(null); setLogs([]); }}
                 className="text-sm text-slate-400 hover:text-white"
               >
                 Start New Conversion
               </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-200px)]">
              
              {/* Left Sidebar: Summary */}
              <div className="lg:col-span-3 space-y-6 h-full overflow-y-auto pr-2">
                <div className="bg-[#1e293b] p-5 rounded-xl border border-slate-700 shadow-lg">
                   <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-4">Analysis Report</h3>
                   
                   <div className="space-y-4">
                      <div>
                        <label className="text-xs text-slate-500">File Type</label>
                        <div className="font-mono text-indigo-300 capitalize">{result.summary.fileType}</div>
                      </div>
                      
                      <div>
                        <label className="text-xs text-slate-500">Detected Structure</label>
                        <div className="font-mono text-slate-200">{result.summary.detectedTables.count} Tables</div>
                        <div className="text-xs text-slate-400">{result.summary.detectedTables.dimensions.join(', ')}</div>
                      </div>

                      <div>
                        <label className="text-xs text-slate-500">Template Matching</label>
                        {result.summary.matchedTemplate?.isMatch ? (
                          <div className="mt-1 bg-green-900/30 border border-green-800 rounded-lg p-3">
                            <div className="text-green-400 font-bold text-sm flex items-center gap-1">
                               <CheckCircle2 className="w-3 h-3" /> Match Found
                            </div>
                            <div className="text-xs text-green-200 mt-1 truncate">
                              {result.summary.matchedTemplate.templateName}
                            </div>
                            <div className="text-[10px] text-green-300/70 mt-1 leading-tight">
                              {result.summary.matchedTemplate.reasoning}
                            </div>
                          </div>
                        ) : (
                          <div className="mt-1 bg-slate-800 border border-slate-700 rounded-lg p-3">
                            <div className="text-slate-400 text-xs font-medium">No Template Match</div>
                            <div className="text-[10px] text-slate-500 mt-1 leading-tight">
                              Generated new structure from scratch.
                            </div>
                          </div>
                        )}
                      </div>
                   </div>
                </div>
                
                {/* Tabs for Mobile (or if sidebar is preferred) */}
                <div className="flex flex-col gap-2">
                  <button 
                    onClick={() => setActiveTab('pdf')}
                    className={`text-left px-4 py-3 rounded-xl transition-all flex items-center gap-3 ${activeTab === 'pdf' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/20' : 'bg-[#1e293b] text-slate-400 hover:bg-[#2d3b4f]'}`}
                  >
                    <FileText className="w-4 h-4" />
                    <span className="font-medium">pdfmake Config</span>
                  </button>
                  <button 
                    onClick={() => setActiveTab('excel')}
                    className={`text-left px-4 py-3 rounded-xl transition-all flex items-center gap-3 ${activeTab === 'excel' ? 'bg-green-600 text-white shadow-lg shadow-green-900/20' : 'bg-[#1e293b] text-slate-400 hover:bg-[#2d3b4f]'}`}
                  >
                    <Code2 className="w-4 h-4" />
                    <span className="font-medium">ExcelJS Script</span>
                  </button>
                  <button 
                    onClick={() => setActiveTab('data')}
                    className={`text-left px-4 py-3 rounded-xl transition-all flex items-center gap-3 ${activeTab === 'data' ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' : 'bg-[#1e293b] text-slate-400 hover:bg-[#2d3b4f]'}`}
                  >
                    <Database className="w-4 h-4" />
                    <span className="font-medium">Extracted JSON</span>
                  </button>
                </div>
              </div>

              {/* Right: Editor Area */}
              <div className="lg:col-span-9 h-full">
                 {activeTab === 'pdf' && (
                    <CodeBlock 
                      code={result.pdfMakeCode} 
                      language="javascript" 
                      filename="generatePDF.js" 
                    />
                 )}
                 {activeTab === 'excel' && (
                    <CodeBlock 
                      code={result.excelJSCode} 
                      language="javascript" 
                      filename="generateExcel.js" 
                    />
                 )}
                 {activeTab === 'data' && (
                    <CodeBlock 
                      code={JSON.stringify(result.extractedData, null, 2)} 
                      language="json" 
                      filename="data.json" 
                    />
                 )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}


