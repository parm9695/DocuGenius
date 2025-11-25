
const SALT = 'DocuGenius_Client_Secret_Salt_v1';

export const secureStorage = {
  /**
   * Simple XOR Cipher + Base64 Encoding
   * Note: This is client-side obfuscation to prevent plain-text reading.
   * It is not enterprise-grade encryption as the salt is exposed in the bundle.
   */
  encrypt: (text: string): string => {
    if (!text) return '';
    try {
      const textChars = text.split('').map(c => c.charCodeAt(0));
      const saltChars = SALT.split('').map(c => c.charCodeAt(0));
      const encrypted = textChars.map((char, i) => 
        char ^ saltChars[i % saltChars.length]
      );
      return btoa(String.fromCharCode(...encrypted));
    } catch (e) {
      console.error("Encryption failed", e);
      return text; 
    }
  },

  decrypt: (text: string): string => {
    if (!text) return '';
    
    // Backward Compatibility Check:
    // Google API Keys typically start with 'AIza'. 
    // If the stored text starts with 'AIza', it's likely an old plain-text key.
    if (text.startsWith('AIza')) {
      return text;
    }

    try {
      const encrypted = atob(text);
      const encryptedChars = encrypted.split('').map(c => c.charCodeAt(0));
      const saltChars = SALT.split('').map(c => c.charCodeAt(0));
      const decrypted = encryptedChars.map((char, i) => 
        char ^ saltChars[i % saltChars.length]
      );
      return String.fromCharCode(...decrypted);
    } catch (e) {
      // If decryption fails (e.g. invalid format), return original text to be safe
      return text;
    }
  },

  setItem: (key: string, value: string) => {
    const encryptedValue = secureStorage.encrypt(value);
    localStorage.setItem(key, encryptedValue);
  },

  getItem: (key: string): string | null => {
    const value = localStorage.getItem(key);
    if (!value) return null;
    return secureStorage.decrypt(value);
  },

  removeItem: (key: string) => {
    localStorage.removeItem(key);
  }
};
