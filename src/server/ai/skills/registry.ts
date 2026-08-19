import { AISkillDefinition, AISkillCategory } from '../types';

export class SkillRegistry {
  private static instance: SkillRegistry;
  private skills: Map<string, AISkillDefinition> = new Map();

  private constructor() {}

  public static getInstance(): SkillRegistry {
    if (!SkillRegistry.instance) {
      SkillRegistry.instance = new SkillRegistry();
    }
    return SkillRegistry.instance;
  }

  public registerSkill(skill: AISkillDefinition): void {
    if (this.skills.has(skill.id)) {
      console.warn(`Skill with ID "${skill.id}" is already registered. Overwriting.`);
    }
    this.skills.set(skill.id, skill);
  }

  public getSkill(id: string): AISkillDefinition | undefined {
    return this.skills.get(id);
  }

  public listSkills(category?: AISkillCategory): AISkillDefinition[] {
    const all = Array.from(this.skills.values());
    if (category) {
      return all.filter((s) => s.category === category && s.enabled);
    }
    return all.filter((s) => s.enabled);
  }

  public filterByPermission(userPermissions: string[]): AISkillDefinition[] {
    const hasWildcard = userPermissions.includes('*');
    return Array.from(this.skills.values()).filter((skill) => {
      if (!skill.enabled) return false;
      if (hasWildcard) return true;
      if (skill.requiredPermissions.length === 0) return true;
      return skill.requiredPermissions.some((perm) => userPermissions.includes(perm));
    });
  }

  public clear(): void {
    this.skills.clear();
  }
}

export const skillRegistry = SkillRegistry.getInstance();
