"""Setup script for bugalint"""

from setuptools import setup  # type: ignore

setup(
    name='bugalint',
    version='3.0.0',
    url='https://github.com/bugale/bugalint',
    license='MIT',
    author='Bugale',
    author_email='bugale@bugalit.com',
    description='An abstraction for running linters on code',
    packages=['bugalint'],
    package_data={'': ['*.ini']},
    zip_safe=False,
    platforms='any',
    install_requires=['lintly', 'flake8', 'mypy', 'pylint'],
    entry_points={
        'console_scripts': [
            'bugalint = bugalint.cli:main',
        ],
    },
    classifiers=[
        'Development Status :: 5 - Production/Stable',
        'Environment :: Console',
        'Intended Audience :: Developers',
        'License :: OSI Approved :: MIT License',
        'Operating System :: POSIX',
        'Operating System :: MacOS',
        'Operating System :: Unix',
        'Operating System :: Microsoft :: Windows',
        'Programming Language :: Python',
        'Programming Language :: Python :: 3.7',
        'Programming Language :: Python :: 3.8',
        'Programming Language :: Python :: 3.9',
        'Programming Language :: Python :: 3.10',
        'Topic :: Software Development :: Libraries :: Python Modules',
        'Topic :: Software Development :: Quality Assurance',
    ]
)
