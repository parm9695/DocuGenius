
import React, { useCallback } from 'react';

interface FileUploaderProps {
  label: string;
  subLabel?: string;
  onFileSelect: (files: File[]) => void;
  multiple?: boolean;
  accept?: string;
  files: File[];
  onRemove: (index: number) => void;
  icon?: React.ReactNode;
}

export const FileUploader: React.FC<FileUploaderProps> = ({ 
  label, 
  subLabel, 
  onFileSelect, 
  multiple = false, 
  accept = ".pdf,.xlsx,.xls,.png,.jpg,.jpeg",
  files,
  onRemove,
  icon
}) => {
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length > 0) {
      if (!multiple) {
        onFileSelect([droppedFiles[0]]);
      } else {
        onFileSelect(droppedFiles);
      }
    }
  }, [onFileSelect, multiple]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
        const selectedFiles = Array.from(e.target.files);
        onFileSelect(selectedFiles);
    }
  };

  return (
    <div className="w-full">
      <div 
        className="border-2 border-dashed border-slate-300 rounded-xl p-8 bg-slate-50 hover:bg-slate-100 transition-colors text-center cursor-pointer relative group"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        <input 
          type="file" 
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
          onChange={handleChange}
          accept={accept}
          multiple={multiple}
        />
        <div className="flex flex-col items-center justify-center gap-3 group-hover:scale-105 transition-transform duration-200">
          {icon && <div className="text-indigo-500 mb-2">{icon}</div>}
          <h3 className="text-slate-700 font-semibold text-lg">{label}</h3>
          {subLabel && <p className="text-slate-500 text-sm">{subLabel}</p>}
        </div>
      </div>

      {/* File List */}
      {files.length > 0 && (
        <div className="mt-4 max-h-[300px] overflow-y-auto custom-scrollbar pr-1">
          <ul className="space-y-2">
            {files.map((f, i) => {
              // Check for custom metadata added by templateStorage
              const addedBy = (f as any)._addedBy;
              const isSystem = (f as any)._isSystem;
              const isShared = !!addedBy;

              return (
                <li key={i} className={`flex items-center justify-between bg-white p-3 rounded-lg border shadow-sm hover:shadow-md transition-shadow ${isSystem ? 'border-purple-200 bg-purple-50/50' : 'border-slate-200'}`}>
                  <div className="flex items-center gap-3 overflow-hidden">
                    <span className={`w-8 h-8 flex-shrink-0 flex items-center justify-center rounded text-xs font-bold uppercase ${isSystem ? 'bg-purple-100 text-purple-600' : 'bg-indigo-100 text-indigo-600'}`}>
                        {f.name.split('.').pop()?.slice(0, 3)}
                    </span>
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-medium text-slate-700 truncate max-w-[180px]" title={f.name}>
                        {f.name}
                      </span>
                      <div className="flex items-center gap-2 text-[10px] text-slate-400">
                        <span>{(f.size / 1024).toFixed(1)} KB</span>
                        {isShared && (
                          <>
                            <span>•</span>
                            <span className={`${isSystem ? 'text-purple-600 font-bold' : 'text-purple-500 font-medium'}`}>
                              {isSystem ? 'Shared Library' : `By ${addedBy}`}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  {!isSystem && (
                    <button 
                      onClick={() => onRemove(i)}
                      className="text-slate-300 hover:text-red-500 transition-colors p-1"
                      title="Remove file"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};
