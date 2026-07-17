import { describe, it, expect, beforeEach } from 'vitest';
import {
  register,
  getAll,
  getByKey,
  getByCategory,
  isRegistered,
  getCount,
  clearRegistry,
  registerDefaultFeatures,
  RegisterFeature,
  type FeatureDefinition,
  type FeatureCategory,
} from './index.js';

describe('Feature Registry', () => {
  beforeEach(() => {
    clearRegistry();
  });

  describe('register()', () => {
    it('registers a valid feature', () => {
      const feature: FeatureDefinition = {
        key: 'test.feature',
        name: 'Test Feature',
        description: 'A test feature',
        category: 'input_channels',
      };

      register(feature);

      expect(isRegistered('test.feature')).toBe(true);
      expect(getCount()).toBe(1);
    });

    it('is idempotent — re-registering same key does not duplicate', () => {
      const feature: FeatureDefinition = {
        key: 'test.idempotent',
        name: 'Test Feature',
        description: 'A test feature',
        category: 'input_channels',
      };

      register(feature);
      register(feature);
      register(feature);

      expect(getCount()).toBe(1);
    });

    it('throws on empty key', () => {
      expect(() =>
        register({
          key: '',
          name: 'Test',
          description: 'Test',
          category: 'input_channels',
        }),
      ).toThrow('Feature key is required');
    });

    it('throws on empty name', () => {
      expect(() =>
        register({
          key: 'test.key',
          name: '',
          description: 'Test',
          category: 'input_channels',
        }),
      ).toThrow('Feature name is required');
    });

    it('throws on empty description', () => {
      expect(() =>
        register({
          key: 'test.key',
          name: 'Test',
          description: '',
          category: 'input_channels',
        }),
      ).toThrow('Feature description is required');
    });

    it('throws on invalid category', () => {
      expect(() =>
        register({
          key: 'test.key',
          name: 'Test',
          description: 'Test',
          category: 'invalid_category' as FeatureCategory,
        }),
      ).toThrow("Invalid category 'invalid_category'");
    });

    it('sets registeredAt timestamp', () => {
      const before = new Date().toISOString();
      register({
        key: 'test.timestamp',
        name: 'Test',
        description: 'Test',
        category: 'input_channels',
      });
      const after = new Date().toISOString();

      const entry = getByKey('test.timestamp');
      expect(entry).not.toBeNull();
      expect(entry!.registeredAt >= before).toBe(true);
      expect(entry!.registeredAt <= after).toBe(true);
    });
  });

  describe('getAll()', () => {
    it('returns empty array when no features registered', () => {
      expect(getAll()).toEqual([]);
    });

    it('returns all registered features', () => {
      register({
        key: 'feat.one',
        name: 'One',
        description: 'First',
        category: 'input_channels',
      });
      register({
        key: 'feat.two',
        name: 'Two',
        description: 'Second',
        category: 'ai_capabilities',
      });

      const all = getAll();
      expect(all).toHaveLength(2);
      expect(all.map((f) => f.key)).toContain('feat.one');
      expect(all.map((f) => f.key)).toContain('feat.two');
    });
  });

  describe('getByKey()', () => {
    it('returns the feature when found', () => {
      register({
        key: 'input.sms',
        name: 'SMS Input',
        description: 'SMS channel',
        category: 'input_channels',
      });

      const result = getByKey('input.sms');
      expect(result).not.toBeNull();
      expect(result!.key).toBe('input.sms');
      expect(result!.name).toBe('SMS Input');
      expect(result!.category).toBe('input_channels');
    });

    it('returns null when not found', () => {
      expect(getByKey('nonexistent.key')).toBeNull();
    });
  });

  describe('getByCategory()', () => {
    it('returns features filtered by category', () => {
      register({
        key: 'input.sms',
        name: 'SMS',
        description: 'SMS',
        category: 'input_channels',
      });
      register({
        key: 'input.api',
        name: 'API',
        description: 'API',
        category: 'input_channels',
      });
      register({
        key: 'ai.categorization',
        name: 'Categorization',
        description: 'Categorization',
        category: 'ai_capabilities',
      });

      const inputChannels = getByCategory('input_channels');
      expect(inputChannels).toHaveLength(2);
      expect(inputChannels.every((f) => f.category === 'input_channels')).toBe(true);

      const aiCaps = getByCategory('ai_capabilities');
      expect(aiCaps).toHaveLength(1);
      expect(aiCaps[0].key).toBe('ai.categorization');
    });

    it('returns empty array for category with no features', () => {
      register({
        key: 'input.sms',
        name: 'SMS',
        description: 'SMS',
        category: 'input_channels',
      });

      expect(getByCategory('advanced')).toEqual([]);
    });
  });

  describe('isRegistered()', () => {
    it('returns true for registered keys', () => {
      register({
        key: 'test.registered',
        name: 'Test',
        description: 'Test',
        category: 'input_channels',
      });

      expect(isRegistered('test.registered')).toBe(true);
    });

    it('returns false for unregistered keys', () => {
      expect(isRegistered('not.registered')).toBe(false);
    });
  });

  describe('clearRegistry()', () => {
    it('removes all registered features', () => {
      register({
        key: 'test.clear',
        name: 'Test',
        description: 'Test',
        category: 'input_channels',
      });

      expect(getCount()).toBe(1);
      clearRegistry();
      expect(getCount()).toBe(0);
      expect(getAll()).toEqual([]);
    });
  });

  describe('RegisterFeature decorator', () => {
    it('registers the feature and returns the class unchanged', () => {
      @RegisterFeature({
        key: 'decorator.test',
        name: 'Decorator Test',
        description: 'Tests the decorator pattern',
        category: 'integrations',
      })
      class TestService {
        getValue(): string {
          return 'hello';
        }
      }

      expect(isRegistered('decorator.test')).toBe(true);
      const instance = new TestService();
      expect(instance.getValue()).toBe('hello');
    });
  });

  describe('registerDefaultFeatures()', () => {
    it('registers all 13 default features', () => {
      registerDefaultFeatures();

      expect(getCount()).toBe(13);
    });

    it('registers all expected feature keys', () => {
      registerDefaultFeatures();

      const expectedKeys = [
        'input.sms',
        'input.api',
        'input.csv',
        'ai.categorization',
        'ai.relationship_mapping',
        'ai.natural_language',
        'ai.cluster_summaries',
        'ai.suggestions',
        'ai.priority_processing',
        'integration.notion',
        'integration.n8n',
        'export.csv',
        'advanced.custom_categories',
      ];

      for (const key of expectedKeys) {
        expect(isRegistered(key)).toBe(true);
      }
    });

    it('registers correct categories for each feature', () => {
      registerDefaultFeatures();

      // Input channels
      expect(getByKey('input.sms')?.category).toBe('input_channels');
      expect(getByKey('input.api')?.category).toBe('input_channels');
      expect(getByKey('input.csv')?.category).toBe('input_channels');

      // AI capabilities
      expect(getByKey('ai.categorization')?.category).toBe('ai_capabilities');
      expect(getByKey('ai.relationship_mapping')?.category).toBe('ai_capabilities');
      expect(getByKey('ai.natural_language')?.category).toBe('ai_capabilities');
      expect(getByKey('ai.cluster_summaries')?.category).toBe('ai_capabilities');
      expect(getByKey('ai.suggestions')?.category).toBe('ai_capabilities');
      expect(getByKey('ai.priority_processing')?.category).toBe('ai_capabilities');

      // Integrations
      expect(getByKey('integration.notion')?.category).toBe('integrations');
      expect(getByKey('integration.n8n')?.category).toBe('integrations');

      // Export formats
      expect(getByKey('export.csv')?.category).toBe('export_formats');

      // Advanced
      expect(getByKey('advanced.custom_categories')?.category).toBe('advanced');
    });

    it('each feature has a non-empty name and description', () => {
      registerDefaultFeatures();

      const all = getAll();
      for (const feature of all) {
        expect(feature.name.length).toBeGreaterThan(0);
        expect(feature.description.length).toBeGreaterThan(0);
      }
    });

    it('is idempotent — calling multiple times does not add duplicates', () => {
      registerDefaultFeatures();
      registerDefaultFeatures();
      registerDefaultFeatures();

      expect(getCount()).toBe(13);
    });

    it('getByCategory returns correct counts', () => {
      registerDefaultFeatures();

      expect(getByCategory('input_channels')).toHaveLength(3);
      expect(getByCategory('ai_capabilities')).toHaveLength(6);
      expect(getByCategory('integrations')).toHaveLength(2);
      expect(getByCategory('export_formats')).toHaveLength(1);
      expect(getByCategory('advanced')).toHaveLength(1);
    });
  });
});
