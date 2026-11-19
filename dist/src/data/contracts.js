/**
 * Repository port, shared by local and future remote adapters.
 * All returned records are detached values; mutation only occurs via transactions.
 * UI uses TodoService, never the driver or IndexedDB.
 *
 * @template T
 * @typedef {{list:()=>Promise<T[]>, get:(id:string)=>Promise<T|undefined>, put:(record:T)=>Promise<void>, delete:(id:string)=>Promise<void>}} Repository
 * @typedef {{projects:Repository<import('../domain/model.js').Project>, processes:Repository<import('../domain/model.js').Process>, tasks:Repository<import('../domain/model.js').Task>, workLogs:Repository<import('../domain/model.js').WorkLog>, settings:Repository<Object>}} UnitOfWork
 * @typedef {{snapshot:()=>Promise<Object>, transaction:(stores:string[],work:(uow:UnitOfWork)=>Promise<any>)=>Promise<any>, close:()=>void}} RepositoryProvider
 * A future API adapter must preserve atomic writes, version conflicts and read scope.
 * An API response is mapped into these local models in data/group-mapper.js (future).
 */
class EntityRepository { constructor(driver){this.driver=driver;} list(){return this.driver.list();} get(id){return this.driver.get(id);} put(value){return this.driver.put(value);} delete(id){return this.driver.delete(id);} }
export class TaskRepository extends EntityRepository {}
export class ProjectRepository extends EntityRepository {}
export class ProcessRepository extends EntityRepository {}
export class WorkLogRepository extends EntityRepository {}
export class SettingsRepository extends EntityRepository {}
export const REPOSITORIES={tasks:TaskRepository,projects:ProjectRepository,processes:ProcessRepository,workLogs:WorkLogRepository,settings:SettingsRepository};
