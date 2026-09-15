"""Bounded sequential dispatcher for predeclared public task attempts."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time


def main():
    p=argparse.ArgumentParser()
    for k in ('runtime','repo','dataset','output','provider-config'):
        p.add_argument('--'+k,required=True)
    p.add_argument('--tasks',nargs='+',required=True)
    p.add_argument('--arms',nargs='+',default=['B0','B4'])
    p.add_argument('--repetitions',type=int,default=1)
    args=p.parse_args()
    out=Path(args.output);out.mkdir(parents=True,exist_ok=False)
    plan={'tasks':args.tasks,'arms':args.arms,'repetitions':args.repetitions,'created_at':time.time(),
          'limits':{'max_wall_seconds':86400,'max_reported_input_tokens':12000000,'max_reported_output_tokens':500000}}
    (out/'plan.json').write_text(json.dumps(plan,indent=2))
    runtime=Path(args.runtime)
    env=os.environ.copy();env['DOCKER_HOST']='unix://'+str(runtime/'docker.sock')
    started=time.monotonic(); records=[];totals={'input_tokens':0,'output_tokens':0}
    here=Path(__file__).resolve().parent
    for n in range(1,args.repetitions+1):
        for task in args.tasks:
            for arm in args.arms:
                if time.monotonic()-started>86400 or totals['input_tokens']>=12000000 or totals['output_tokens']>=500000:
                    raise RuntimeError('Aggregate campaign dispatch limit reached')
                label=f'{task}-{arm}-{n}'
                attempt=out/'runs'/label
                image='swebench/sweb.eval.x86_64.'+task.lower().replace('__','_1776_')+':latest'
                cmd=[sys.executable,str(here/'run_task.py'),'--runtime',args.runtime,'--repo',args.repo,
                     '--dataset',args.dataset,'--output',str(attempt),'--provider-config',args.provider_config,
                     '--task',task,'--arm',arm,'--attempt',str(n),'--image',image]
                with (out/(label+'.log')).open('wb') as log:
                    proc=subprocess.run(cmd,stdout=log,stderr=subprocess.STDOUT,env=env,timeout=780)
                record={'task':task,'arm':arm,'attempt':n,'execution_exit':proc.returncode}
                if (attempt/'attempt.json').exists():
                    data=json.loads((attempt/'attempt.json').read_text())
                    for session in data['sessions']:
                        usage=session.get('usage') or {}
                        for k in totals:
                            if isinstance(usage.get(k),int):
                                totals[k]+=usage[k]
                    evaluation=out/'evaluations'/label
                    cmd=[str(runtime/'venv/bin/python'),str(here/'evaluate_task.py'),
                         '--runtime',args.runtime,'--dataset',args.dataset,'--attempt',str(attempt),
                         '--task',task,'--image',image,'--output',str(evaluation),'--kind','model']
                    with (out/(label+'-evaluation.log')).open('wb') as log:
                        result=subprocess.run(cmd,stdout=log,stderr=subprocess.STDOUT,env=env,timeout=1000)
                    record['evaluation_exit']=result.returncode
                    if (evaluation/'receipt.json').exists():
                        record['result']=json.loads((evaluation/'receipt.json').read_text())['result']
                records.append(record)
                (out/'progress.json').write_text(json.dumps({'records':records,'totals':totals,'updated_at':time.time()},indent=2))
                print(json.dumps(record),flush=True)


if __name__=='__main__':
    main()
