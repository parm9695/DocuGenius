export interface FileWithPreview {
  file: File;
  previewUrl?: string;
  type: 'pdf' | 'excel' | 'image';
}

export interface AnalysisSummary {
  fileType: string;
  detectedTables: {
    count: number;
    dimensions: string[]; // e.g., ["5 cols x 10 rows"]
  };
  headers: {
    title: string;
    subtitle?: string;
  };
  matchedTemplate?: {
    isMatch: boolean;
    templateName?: string;
    matchConfidence?: string;
    reasoning?: string;
  };
}

export interface AnalysisResult {
  summary: AnalysisSummary;
  pdfMakeCode: string;
  excelJSCode: string;
  extractedData: any[]; // JSON data representation
}
