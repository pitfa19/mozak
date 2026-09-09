# Permission matrix

| Action | Owner | Local deterministic process | Agent/model | Connector |
|---|---:|---:|---:|---:|
| read accepted state | yes | yes | delegated | no |
| read raw snapshot | yes | yes | delegated | no |
| discover/fetch approved source | yes | yes | propose | yes, bounded |
| create immutable snapshot | yes | yes | no | submit bytes |
| propose candidate or patch | yes | yes | yes | no |
| accept/reject/retract claim | yes | no | no | no |
| configure source or retention policy | yes | no | no | no |
| generate derived view | yes | yes | yes | no |
| release packet | yes | no | propose | no |
| export brain | yes | delegated | no | no |
| perform external write | explicit approval | no | propose | bounded after approval |

Delegation is versioned, scoped, revocable, and denied by default.
