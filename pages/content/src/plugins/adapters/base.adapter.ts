import type { 
  AdapterPlugin, 
  PluginContext, 
  AdapterCapability, 
  DetectedTool 
} from '../plugin-types';
import { PageController } from '@page-agent/page-controller';

/**
 * BaseAdapterPlugin provides a foundational class for all adapter plugins.
 * It includes common lifecycle methods and utility functions that can be overridden or extended by specific adapters.
 */
export abstract class BaseAdapterPlugin implements AdapterPlugin {
  abstract readonly name: string;
  abstract readonly version: string;
  abstract readonly hostnames: string[] | RegExp[];
  abstract readonly capabilities: AdapterCapability[];

  protected context!: PluginContext;
  protected currentStatus: 'pending' | 'initializing' | 'active' | 'inactive' | 'error' | 'disabled' = 'pending';

  // PageController instance for advanced DOM operations (W3C events, Slate.js support, etc.)
  protected pageController: PageController | null = null;

  constructor() {
    // Constructor can be used for initial setup common to all plugins derived from BaseAdapterPlugin
    // but before context is available.
  }

  async initialize(context: PluginContext): Promise<void> {
    this.context = context;
    this.currentStatus = 'initializing';
    this.context.logger.debug(`Initializing (Base)`);
    // Initialize PageController with mask disabled (adapters handle their own UI)
    try {
      this.pageController = new PageController({ enableMask: false });
      this.context.logger.debug('PageController initialized successfully');
    } catch (error) {
      this.context.logger.warn('Failed to initialize PageController, falling back to manual DOM operations:', error);
      this.pageController = null;
    }
    // Basic initialization logic common to all plugins
    // Specific plugins should override this and call super.initialize(context) if needed.
    this.currentStatus = 'inactive'; // Default to inactive after base initialization
  }

  async activate(): Promise<void> {
    this.context.logger.debug(`Activating (Base)`);
    // Basic activation logic
    // Specific plugins should override this and call super.activate() if needed.
    this.currentStatus = 'active';
  }

  async deactivate(): Promise<void> {
    this.context.logger.debug(`Deactivating (Base)`);
    // Basic deactivation logic
    // Specific plugins should override this and call super.deactivate() if needed.
    this.currentStatus = 'inactive';
  }

  async cleanup(): Promise<void> {
    this.context.logger.debug(`Cleaning up (Base)`);
    // Clean up PageController resources
    if (this.pageController) {
      try {
        this.pageController.dispose();
        this.pageController = null;
      } catch (error) {
        this.context.logger.warn('Error disposing PageController:', error);
      }
    }
    // Basic cleanup logic
    // Specific plugins should override this and call super.cleanup() if needed.
    this.currentStatus = 'disabled'; // Or 'pending' if it can be reinitialized
  }

  // Core functionality - to be implemented by specific adapters if capability is supported
  async insertText(text: string, options?: { targetElement?: HTMLElement }): Promise<boolean> {
    this.context.logger.warn('insertText not implemented by this adapter.');
    return false;
  }

  async submitForm(options?: { formElement?: HTMLFormElement }): Promise<boolean> {
    this.context.logger.warn('submitForm not implemented by this adapter.');
    return false;
  }

  // ======= PageController-based helper methods =======

  /**
   * Input text into an element by CSS selector using PageController.
   * Provides W3C standard event simulation and rich text editor support (Slate.js, React, etc.)
   * Subclasses can call this from their insertText() implementation.
   */
  protected async inputBySelector(selector: string, text: string): Promise<boolean> {
    if (!this.pageController) {
      this.context.logger.warn('PageController not available, cannot use inputBySelector');
      return false;
    }
    try {
      const result = await this.pageController.inputBySelector(selector, text);
      if (!result.success) {
        this.context.logger.warn(`inputBySelector failed: ${result.message}`);
      }
      return result.success;
    } catch (error) {
      this.context.logger.error('inputBySelector error:', error);
      return false;
    }
  }

  /**
   * Click an element by CSS selector using PageController.
   * Provides W3C standard click event simulation (pointerover → mousedown → click).
   * Subclasses can call this from their submitForm() implementation.
   */
  protected async clickBySelector(selector: string): Promise<boolean> {
    if (!this.pageController) {
      this.context.logger.warn('PageController not available, cannot use clickBySelector');
      return false;
    }
    try {
      const result = await this.pageController.clickBySelector(selector);
      if (!result.success) {
        this.context.logger.warn(`clickBySelector failed: ${result.message}`);
      }
      return result.success;
    } catch (error) {
      this.context.logger.error('clickBySelector error:', error);
      return false;
    }
  }

  async attachFile(file: File, options?: { inputElement?: HTMLInputElement }): Promise<boolean> {
    this.context.logger.warn('attachFile not implemented by this adapter.');
    return false;
  }

  // Optional capabilities - to be implemented by specific adapters
  async captureScreenshot(): Promise<string> {
    this.context.logger.warn('captureScreenshot not implemented by this adapter.');
    throw new Error('Not implemented');
  }

  async selectElement(selector: string): Promise<HTMLElement | null> {
    this.context.logger.warn('selectElement not implemented by this adapter.');
    return null;
  }

  async navigateToUrl(url: string): Promise<boolean> {
    this.context.logger.warn('navigateToUrl not implemented by this adapter.');
    return false;
  }
  
  async executeScript<T>(script: string | (() => T)): Promise<T | null> {
    this.context.logger.warn('executeScript not implemented by this adapter.');
    return null;
  }

  // Utility methods
  isSupported(): boolean | Promise<boolean> {
    // By default, if an adapter is defined for a hostname, it's considered supported.
    // Specific adapters can override this for more complex checks (e.g., specific page elements exist).
    return true;
  }

  getStatus(): 'active' | 'inactive' | 'error' | 'initializing' | 'disabled' | 'pending' {
    return this.currentStatus;
  }

  protected setStatus(status: 'active' | 'inactive' | 'error' | 'initializing' | 'disabled' | 'pending', error?: string | Error): void {
    this.currentStatus = status;
    if (status === 'error' && error) {
        this.context.logger.error('Status set to error:', error);
        // Optionally emit an event or update store directly if context allows
    }
  }

  // Event handlers - can be overridden by specific adapters
  onToolDetected?(tools: DetectedTool[]): void {
    this.context.logger.debug('onToolDetected (Base):', tools);
  }

  onPageChanged?(url: string, oldUrl?: string): void {
    this.context.logger.debug(`onPageChanged (Base): from ${oldUrl || 'N/A'} to ${url}`);
  }
  
  onHostChanged?(newHost: string, oldHost?: string): void {
    this.context.logger.debug(`onHostChanged (Base): from ${oldHost || 'N/A'} to ${newHost}`);
    // Base implementation could re-check isSupported or trigger adapter re-evaluation
    // For example, if an adapter is only for a specific path on a host.
  }

  /**
   * Check if this adapter should handle events
   * Only active adapters on supported sites should handle events
   */
  protected shouldHandleEvents(): boolean {
    // Only handle events if adapter is active
    if (this.currentStatus !== 'active') {
      return false;
    }

    // Only handle events if the current site is supported
    try {
      const isSupported = this.isSupported();
      // Handle both sync and async isSupported implementations
      if (typeof isSupported === 'boolean') {
        return isSupported;
      }
      // For async implementations, we assume supported for now
      // (this could be improved with caching)
      return true;
    } catch (error) {
      this.context.logger.error('Error checking if site is supported:', error);
      return false;
    }
  }
}
