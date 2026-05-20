import React, { useState, useMemo, useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import Layout from './components/Layout';
import UploadStep from './components/UploadStep';
import PaymentStep from './components/PaymentStep';
import PrintingStep from './components/PrintingStep';
import { KioskStep, PrintSettings } from './types';
import { printService } from './services/printService';

// Initialize PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://esm.sh/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs';

// Internal component for rendering PDF pages to canvas
const PdfRenderer: React.FC<{ url: string; page: number; colorMode: 'color' | 'bw' }> = ({ url, page, colorMode }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const renderPage = async () => {
      if (!url) return;
      setLoading(true);
      try {
        const loadingTask = pdfjsLib.getDocument(url);
        const pdf = await loadingTask.promise;
        const pdfPage = await pdf.getPage(page);
        
        if (!active) return;
        
        const canvas = canvasRef.current;
        if (!canvas) return;

        // Render at a higher scale for better quality, then scale down via CSS
        const viewport = pdfPage.getViewport({ scale: 1.5 });
        const context = canvas.getContext('2d');
        
        if (context) {
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          
          await pdfPage.render({
            canvasContext: context,
            viewport: viewport
          } as any).promise;
        }
      } catch (e) {
        console.error("PDF Render Error:", e);
      } finally {
        if (active) setLoading(false);
      }
    };

    renderPage();
    return () => { active = false; };
  }, [url, page]);

  return (
    <div className="w-full h-full flex items-center justify-center bg-slate-900 relative overflow-hidden">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center z-20 bg-black/50 backdrop-blur-sm">
           <div className="w-8 h-8 border-4 border-red-600 border-t-transparent rounded-full animate-spin"></div>
        </div>
      )}
      <div className={`w-full h-full flex items-center justify-center p-4 transition-all duration-500 ${colorMode === 'bw' ? 'grayscale' : ''}`}>
         <canvas 
           ref={canvasRef} 
           className="max-w-full max-h-full object-contain shadow-2xl shadow-black/50 bg-white" 
         />
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const [step, setStep] = useState<KioskStep>(KioskStep.WELCOME);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileMeta, setFileMeta] = useState<{ name: string; type: string } | null>(null);
  const [pageCount, setPageCount] = useState<number>(1); // Total detected pages in file
  const [isProcessingFile, setIsProcessingFile] = useState<boolean>(false);
  
  // Page Selection State
  const [printRangeMode, setPrintRangeMode] = useState<'all' | 'custom'>('all');
  const [customRange, setCustomRange] = useState<string>('');
  
  // Default Settings
  const [settings, setSettings] = useState<PrintSettings>({
    copies: 1,
    colorMode: 'color',
    orientation: 'portrait',
    sides: 'single'
  });

  // Calculate effective pages to print based on selection
  const effectivePageCount = useMemo(() => {
    if (printRangeMode === 'all') return pageCount;
    
    try {
      const pages = new Set<number>();
      // Split by comma and process each part
      const parts = customRange.split(',').map(p => p.trim()).filter(p => p);
      
      parts.forEach(part => {
        if (part.includes('-')) {
          // Handle ranges like "1-5"
          const rangeParts = part.split('-').map(str => str.trim());
          if (rangeParts.length === 2) {
             const start = parseInt(rangeParts[0], 10);
             const end = parseInt(rangeParts[1], 10);
             
             if (!isNaN(start) && !isNaN(end)) {
               // Ensure range is within valid bounds [1, pageCount]
               const min = Math.max(1, Math.min(start, end));
               const max = Math.min(pageCount, Math.max(start, end));
               
               // Only add pages if the range overlaps with the valid document pages
               if (min <= max) {
                   for (let i = min; i <= max; i++) pages.add(i);
               }
             }
          }
        } else {
          // Handle single pages
          const page = parseInt(part, 10);
          if (!isNaN(page) && page >= 1 && page <= pageCount) {
            pages.add(page);
          }
        }
      });
      
      return pages.size;
    } catch (e) {
      return 0;
    }
  }, [printRangeMode, customRange, pageCount]);

  // Determine the first page of the selected range to update the preview
  const firstPreviewPage = useMemo(() => {
    if (printRangeMode === 'all' || !customRange) return 1;
    // Find the first number in the string
    const match = customRange.match(/(\d+)/);
    if (match) {
        const p = parseInt(match[0], 10);
        return (p >= 1 && p <= pageCount) ? p : 1;
    }
    return 1;
  }, [printRangeMode, customRange, pageCount]);

  // Check if user input exceeds document limits for UI feedback
  const isRangeOutOfBounds = useMemo(() => {
      if (printRangeMode === 'all') return false;
      const numbers = customRange.split(/[,-]/).map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
      return numbers.some(n => n > pageCount);
  }, [customRange, pageCount, printRangeMode]);

  // Price Calculation Logic
  const totalPrice = useMemo(() => {
    const pricePerPage = settings.colorMode === 'color' ? 10.00 : 1.00;
    // Total = Price Per Page * Effective Pages * Number of Copies
    return pricePerPage * (effectivePageCount || 0) * settings.copies;
  }, [settings, effectivePageCount]);

  const resetKiosk = () => {
    setSelectedFile(null);
    setFileMeta(null);
    setPageCount(1);
    setPrintRangeMode('all');
    setCustomRange('');
    setSettings({
      copies: 1,
      colorMode: 'color',
      orientation: 'portrait',
      sides: 'single'
    });
    setStep(KioskStep.WELCOME);
  };

  const handleFileSelected = async (dataUri: string, fileName: string, fileType: string) => {
    setSelectedFile(dataUri);
    setFileMeta({ name: fileName, type: fileType });
    setIsProcessingFile(true);

    try {
      if (fileType === 'application/pdf') {
        const loadingTask = pdfjsLib.getDocument(dataUri);
        const pdf = await loadingTask.promise;
        console.log(`PDF Loaded: ${pdf.numPages} pages detected.`);
        setPageCount(pdf.numPages);
      } else if (fileType.includes('presentation') || fileType.includes('powerpoint')) {
        setPageCount(1);
      } else {
        setPageCount(1);
      }
    } catch (error) {
      console.error("Error detecting file pages:", error);
      setPageCount(1);
    } finally {
      setIsProcessingFile(false);
      setStep(KioskStep.PREVIEW);
    }
  };

  const handleStartPayment = () => {
    if (effectivePageCount > 0) {
      setStep(KioskStep.PAYMENT);
    }
  };

  const handlePaymentSuccess = async () => {
    setStep(KioskStep.PRINTING);
    if (selectedFile) {
      await printService.sendToPrinter(selectedFile, settings);
    }
  };

  const handlePrintFinished = () => {
    setStep(KioskStep.COMPLETE);
  };

  const updateSetting = <K extends keyof PrintSettings>(key: K, value: PrintSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const renderFilePreview = () => {
    if (!selectedFile || !fileMeta) return null;

    if (fileMeta.type.startsWith('image/')) {
      return (
        <img 
          src={selectedFile} 
          alt="Preview" 
          className={`w-full h-full object-contain transition-all duration-300 ${settings.colorMode === 'bw' ? 'grayscale' : ''}`} 
        />
      );
    }

    if (fileMeta.type === 'application/pdf') {
      return (
        <PdfRenderer url={selectedFile} page={firstPreviewPage} colorMode={settings.colorMode} />
      );
    }

    return (
      <div className={`w-full h-full flex flex-col items-center justify-center bg-white/5 text-center p-8 transition-all duration-300 ${settings.colorMode === 'bw' ? 'grayscale' : ''}`}>
        <div className="w-24 h-24 rounded-3xl bg-slate-800 flex items-center justify-center mb-6 border border-slate-700 shadow-xl shadow-black/20">
          <i className={`fas ${fileMeta.type.includes('presentation') || fileMeta.type.includes('powerpoint') ? 'fa-file-powerpoint' : 'fa-file-lines'} text-4xl text-slate-400`}></i>
        </div>
        <h3 className="text-xl font-bold text-white mb-2 truncate max-w-full px-4">{fileMeta.name}</h3>
        <p className="text-slate-500 text-xs uppercase font-bold tracking-widest">
           {fileMeta.type.includes('presentation') ? 'Slides Detected' : 'Pages Detected'}
        </p>
        <div className="mt-6 flex items-center gap-2 px-3 py-1 bg-green-900/30 border border-green-500/30 rounded-full">
           <i className="fas fa-check-circle text-green-500 text-[10px]"></i>
           <span className="text-[10px] font-bold text-green-400 uppercase tracking-wider">Analysis Complete</span>
        </div>
      </div>
    );
  };

  return (
    <Layout step={step}>
      {(step === KioskStep.WELCOME || step === KioskStep.UPLOAD) && (
        <UploadStep onFileSelected={handleFileSelected} />
      )}

      {step === KioskStep.PREVIEW && selectedFile && (
        <div className="flex-1 w-full flex flex-col lg:flex-row gap-6 py-4 animate-in slide-in-from-bottom-4 duration-500">
          
          {/* LEFT: Preview Panel */}
          <div className="w-full lg:w-7/12 flex flex-col">
             <div className="flex justify-between items-center mb-4">
                <div>
                   <h2 className="text-xl font-bold text-white tracking-tight">Your Document</h2>
                </div>
                <button 
                  onClick={resetKiosk}
                  className="text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-white flex items-center gap-2 transition-colors bg-white/5 hover:bg-white/10 px-4 py-2 rounded-full border border-white/10 shadow-sm"
                >
                  <i className="fas fa-arrow-left"></i>
                  Back
                </button>
             </div>

             <div className="flex-1 bg-slate-900/50 backdrop-blur-md rounded-[2rem] border border-white/10 p-2 shadow-2xl relative overflow-hidden group">
                {/* Updated Preview Container with Rotation Logic */}
                <div className={`w-full h-full rounded-[1.5rem] overflow-hidden bg-slate-900 border border-white/5 shadow-inner transition-transform duration-500 ease-in-out
                   ${settings.orientation === 'landscape' ? 'rotate-90 scale-[0.70]' : ''}
                `}>
                   {renderFilePreview()}
                </div>
                
                {/* Floating Stats */}
                <div className="absolute bottom-6 left-6 bg-black/90 backdrop-blur-md px-5 py-2.5 rounded-full border border-white/20 flex items-center gap-4 shadow-xl">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-white">
                        {fileMeta?.type.split('/')[1]?.toUpperCase() || 'FILE'}
                      </span>
                    </div>
                    <div className="w-px h-3 bg-slate-600"></div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-white">
                      {effectivePageCount} Pages
                    </span>
                </div>
             </div>
          </div>

          {/* RIGHT: Settings Panel (Bento Grid) */}
          <div className="w-full lg:w-5/12 flex flex-col">
            <div className="h-full flex flex-col gap-4">
              
              {/* Header Card */}
              <div className="bg-slate-900/80 backdrop-blur-xl rounded-[2rem] border border-white/10 ring-1 ring-white/5 p-6 flex justify-between items-center shadow-lg">
                 <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-slate-800 flex items-center justify-center text-white text-xl border border-white/10 shadow-inner">
                        <i className="fas fa-sliders-h"></i>
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-white leading-tight">Job Settings</h2>
                        <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Configure & Print</p>
                    </div>
                 </div>
              </div>

              {/* Scrollable Settings */}
              <div className="flex-1 bg-slate-900/80 backdrop-blur-xl rounded-[2rem] border border-white/10 ring-1 ring-white/5 p-6 flex flex-col overflow-y-auto custom-scrollbar shadow-lg">
                 
                 {/* Page Range Card */}
                 <div className="bg-white/5 p-5 rounded-3xl border border-white/10 mb-6 shadow-sm">
                    <div className="flex justify-between items-center mb-4">
                       <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Pages</label>
                       <span className="text-[10px] font-bold text-red-400 bg-red-900/20 px-2 py-0.5 rounded border border-red-500/30">{pageCount} Total</span>
                    </div>
                    
                    <div className="flex bg-black/40 p-1 rounded-2xl border border-white/10 mb-4">
                        {['all', 'custom'].map((mode) => (
                           <button
                             key={mode}
                             onClick={() => setPrintRangeMode(mode as 'all' | 'custom')}
                             className={`flex-1 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all
                               ${printRangeMode === mode 
                                 ? 'bg-slate-700 text-white shadow-sm border border-white/10' 
                                 : 'text-slate-500 hover:text-slate-300'}`}
                           >
                             {mode === 'all' ? 'All Pages' : 'Custom Range'}
                           </button>
                        ))}
                    </div>

                    {printRangeMode === 'custom' && (
                        <div className="animate-in slide-in-from-top-2 duration-300">
                           <input 
                              type="text"
                              value={customRange}
                              onChange={(e) => setCustomRange(e.target.value)}
                              placeholder="e.g. 1, 3-5"
                              className={`w-full bg-black/50 border rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-900/50 placeholder-slate-600 transition-all font-mono shadow-inner
                                ${isRangeOutOfBounds ? 'border-red-500/50 bg-red-900/10' : 'border-white/10'}
                              `}
                           />
                           <div className="flex justify-between mt-2 px-1">
                              <span className={`text-[10px] font-bold ${effectivePageCount === 0 ? 'text-red-500' : 'text-slate-400'}`}>
                                 {effectivePageCount} pages selected
                              </span>
                           </div>
                        </div>
                    )}
                 </div>

                 {/* Settings Grid */}
                 <div className="grid grid-cols-2 gap-4 mb-6">
                    {/* Copies */}
                    <div className="bg-white/5 p-5 rounded-3xl border border-white/10 shadow-sm">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 block">Copies</label>
                        <div className="flex items-center justify-between bg-black/40 rounded-xl p-1 border border-white/10">
                           <button onClick={() => updateSetting('copies', Math.max(1, settings.copies - 1))} className="w-8 h-8 rounded-lg bg-slate-800 shadow-sm border border-white/5 text-slate-200 flex items-center justify-center hover:bg-slate-700 transition-colors">
                              <i className="fas fa-minus text-[10px]"></i>
                           </button>
                           <span className="text-lg font-bold text-white">{settings.copies}</span>
                           <button onClick={() => updateSetting('copies', Math.min(99, settings.copies + 1))} className="w-8 h-8 rounded-lg bg-slate-800 shadow-sm border border-white/5 text-slate-200 flex items-center justify-center hover:bg-slate-700 transition-colors">
                              <i className="fas fa-plus text-[10px]"></i>
                           </button>
                        </div>
                    </div>

                    {/* Orientation - NEW */}
                    <div className="bg-white/5 p-5 rounded-3xl border border-white/10 shadow-sm">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 block">Orientation</label>
                        <div className="flex gap-2">
                            {['portrait', 'landscape'].map((orient) => (
                                <button
                                    key={orient}
                                    onClick={() => updateSetting('orientation', orient as 'portrait' | 'landscape')}
                                    className={`flex-1 h-10 rounded-xl flex items-center justify-center text-xs transition-all border
                                    ${settings.orientation === orient 
                                        ? 'bg-red-900/30 border-red-500/50 text-red-400 font-bold shadow-sm' 
                                        : 'bg-black/20 border-white/5 text-slate-500 hover:bg-white/5'}`}
                                >
                                    <i className={`fas ${orient === 'portrait' ? 'fa-file' : 'fa-file'} text-sm ${orient === 'landscape' ? 'rotate-90' : ''}`}></i>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Sides (Layout) - Full Width */}
                    <div className="bg-white/5 p-5 rounded-3xl border border-white/10 shadow-sm col-span-2">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 block">Duplex Printing</label>
                        <div className="flex gap-2">
                            {['single', 'double'].map((side) => (
                                <button
                                    key={side}
                                    onClick={() => updateSetting('sides', side as 'single' | 'double')}
                                    className={`flex-1 h-10 rounded-xl flex items-center justify-center text-xs transition-all border
                                    ${settings.sides === side 
                                        ? 'bg-red-900/30 border-red-500/50 text-red-400 font-bold shadow-sm' 
                                        : 'bg-black/20 border-white/5 text-slate-500 hover:bg-white/5'}`}
                                >
                                    <i className={`fas ${side === 'single' ? 'fa-file' : 'fa-copy'} text-sm mr-2`}></i>
                                    {side === 'single' ? 'Single Sided' : 'Double Sided'}
                                </button>
                            ))}
                        </div>
                    </div>
                 </div>

                 {/* Color Mode Toggle - Full Width */}
                 <div className="bg-white/5 p-5 rounded-3xl border border-white/10 mb-4 shadow-sm">
                     <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 block">Print Mode</label>
                     <div className="flex flex-col gap-2">
                          <button 
                            onClick={() => updateSetting('colorMode', 'color')}
                            className={`flex items-center gap-3 p-3 rounded-2xl border-2 transition-all ${settings.colorMode === 'color' ? 'bg-red-900/20 border-red-500 text-white shadow-md scale-[1.02]' : 'bg-black/20 border-transparent text-slate-500 hover:bg-white/5'}`}
                          >
                             <div className={`w-8 h-8 rounded-full flex items-center justify-center ${settings.colorMode === 'color' ? 'bg-red-600 text-white' : 'bg-slate-800 text-slate-500'}`}>
                                <i className="fas fa-palette text-xs"></i>
                             </div>
                             <div className="flex flex-col items-start">
                                <span className="text-xs font-bold">Color</span>
                                <span className="text-[10px] text-slate-400">Best for Slides</span>
                             </div>
                             <span className="ml-auto text-xs font-bold bg-black/40 border border-white/10 px-2 py-1 rounded-lg text-slate-200 shadow-sm">₹10</span>
                          </button>
                          
                          <button 
                            onClick={() => updateSetting('colorMode', 'bw')}
                            className={`flex items-center gap-3 p-3 rounded-2xl border-2 transition-all ${settings.colorMode === 'bw' ? 'bg-slate-800 border-slate-500 text-white shadow-md scale-[1.02]' : 'bg-black/20 border-transparent text-slate-500 hover:bg-white/5'}`}
                          >
                             <div className={`w-8 h-8 rounded-full flex items-center justify-center ${settings.colorMode === 'bw' ? 'bg-slate-600 text-white' : 'bg-slate-800 text-slate-500'}`}>
                                <i className="fas fa-print text-xs"></i>
                             </div>
                             <div className="flex flex-col items-start">
                                <span className="text-xs font-bold">Grayscale</span>
                                <span className="text-[10px] text-slate-400">Best for Text</span>
                             </div>
                             <span className="ml-auto text-xs font-bold bg-black/40 border border-white/10 px-2 py-1 rounded-lg text-slate-200 shadow-sm">₹1</span>
                          </button>
                     </div>
                 </div>

              </div>

              {/* Checkout Footer */}
              <div className="bg-slate-900/80 backdrop-blur-xl rounded-[2rem] border border-white/10 ring-1 ring-white/5 p-6 shadow-lg">
                 <div className="flex justify-between items-end mb-4">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Estimated Total</span>
                    <div className="text-right">
                       <span className="text-4xl font-extrabold text-white tracking-tight">₹{totalPrice.toFixed(0)}</span>
                       <span className="text-sm font-bold text-slate-500 ml-1">.00</span>
                    </div>
                 </div>
                 
                 <button 
                   onClick={handleStartPayment}
                   disabled={effectivePageCount === 0}
                   className={`w-full py-4 rounded-xl font-bold text-sm uppercase tracking-widest transition-all shadow-xl flex items-center justify-center gap-3 group
                     ${effectivePageCount > 0 
                       ? 'bg-red-600 text-white hover:bg-red-500 hover:scale-[1.02] shadow-red-500/30' 
                       : 'bg-slate-800 text-slate-500 cursor-not-allowed'}`}
                 >
                   Proceed to Pay
                   <i className="fas fa-arrow-right text-xs group-hover:translate-x-1 transition-transform"></i>
                 </button>
              </div>

            </div>
          </div>
        </div>
      )}

      {step === KioskStep.PAYMENT && selectedFile && (
        <PaymentStep 
          amount={totalPrice} 
          image={selectedFile} 
          settings={settings}
          onPaymentComplete={handlePaymentSuccess} 
        />
      )}

      {step === KioskStep.PRINTING && (
        <PrintingStep onComplete={handlePrintFinished} />
      )}

      {step === KioskStep.COMPLETE && (
        <div className="flex-1 flex flex-col items-center justify-center text-center animate-in zoom-in duration-500">
          <div className="w-24 h-24 bg-red-900/30 rounded-[2rem] flex items-center justify-center mb-8 shadow-[0_0_60px_rgba(220,38,38,0.3)] ring-4 ring-red-500/30">
            <i className="fas fa-check text-4xl text-red-500"></i>
          </div>
          <h2 className="text-5xl font-extrabold mb-4 tracking-tight text-white">Printed!</h2>
          <p className="text-slate-400 max-w-sm mb-12 text-lg font-medium">
            Grab your documents from the tray below. Good luck with your class!
          </p>
          
          <button 
            onClick={resetKiosk}
            className="px-8 py-4 bg-white text-black rounded-2xl font-bold text-sm uppercase tracking-widest hover:bg-slate-200 transition-all shadow-xl hover:scale-105"
          >
            Print Another
          </button>
        </div>
      )}
    </Layout>
  );
};

export default App;
