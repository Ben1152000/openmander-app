import { useEffect, useState } from "react";

export function useWasm() {
  const [wasm, setWasm] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    
    const loadWasm = async () => {
      try {
        // Import the WASM module
        const module = await import("../wasm/pkg/openmander");
        
        // Initialize the WASM module (required before use)
        // The default export is the init function that loads the WASM file
        await module.default();
        
        // Now the module is initialized and ready to use
        setWasm(module);
        console.log("WASM module initialized successfully");
      } catch (err) {
        console.error("Failed to load WASM module:", err);
        setError(err as Error);
      } finally {
        setLoading(false);
      }
    };
    
    loadWasm();
  }, []);

  return { wasm, loading, error };
}

